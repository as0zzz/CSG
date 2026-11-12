import asyncio
import hashlib
import json
import os
import re
import subprocess
import tempfile
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, func
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from PIL import Image
from .db import session, Session
from .models import *
from .schemas import *
from .security import current, membership, contractor_only, verify_password, signer
from .services import *
from . import storage


def simulation_tick():
    with Session() as db:
        for equipment in db.scalars(select(Equipment).where(Equipment.sim_state == 'running').with_for_update(skip_locked=True)):
            equipment.sim_step += 1
            axis = db.get(Axis, equipment.axis_id)
            offset = axis.start_m + ((equipment.sim_step * 25) % (axis.end_m - axis.start_m + 1))
            db.add(Point(project_id=equipment.project_id, equipment_id=equipment.id, offset_m=offset,
                         latitude=55.75 + equipment.sim_step % 100 * .00001, longitude=37.6 + equipment.sim_step % 100 * .00001))
        db.commit()


async def ticker():
    while True:
        await asyncio.sleep(3)
        try:
            await asyncio.to_thread(simulation_tick)
        except Exception:
            import logging
            logging.exception('Simulator tick failed')


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(ticker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title='АКСГ · API демонстрационного прототипа', version='1.0.0', lifespan=lifespan)
from .planner import router as planner_router
app.include_router(planner_router)


@app.middleware('http')
async def origin_guard(request: Request, call_next):
    origin = request.headers.get('origin')
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and origin and origin not in ('http://localhost:8080', 'http://127.0.0.1:8080'):
        return JSONResponse({'detail': 'Недопустимый источник запроса'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return JSONResponse({'detail': 'Конфликт: запись уже существует или имеет связанные данные'}, status_code=409)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    fields = ', '.join('.'.join(str(x) for x in e['loc'][1:]) for e in exc.errors())
    return JSONResponse({'detail': f'Проверьте поля: {fields}'}, status_code=422)


@app.get('/api/health')
def health(db: DBSession = Depends(session)):
    db.execute(select(1))
    return {'status': 'ok'}


@app.post('/api/auth/login')
def login(data: Login, response: Response, db: DBSession = Depends(session)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not verify_password(data.password, user.password):
        fail('Неверный логин или пароль', 401)
    response.set_cookie('session', signer.dumps(user.id), httponly=True, samesite='strict', max_age=43200)
    return {'id': user.id, 'name': user.name, 'email': user.email}


@app.post('/api/auth/logout')
def logout(response: Response):
    response.delete_cookie('session')
    return {'ok': True}


@app.get('/api/auth/me')
def me(user=Depends(current)):
    return {'id': user.id, 'name': user.name, 'email': user.email}


@app.get('/api/projects')
def projects(db: DBSession = Depends(session), user=Depends(current)):
    members = list(db.scalars(select(Membership).where(Membership.user_id == user.id)))
    return [{**dump(db.get(Project, m.project_id)), 'roles': m.roles} for m in members]


@app.post('/api/projects')
def project_create(data: ProjectInput, db: DBSession = Depends(session), user=Depends(current)):
    if not any('ProjectAdmin' in m.roles for m in db.scalars(select(Membership).where(Membership.user_id == user.id))):
        fail('Создание проекта доступно администратору', 403)
    if data.start_date > data.end_date:
        fail('Некорректные даты проекта')
    p = Project(**data.model_dump(), demo_base_date=date.today())
    db.add(p)
    db.flush()
    db.add(Membership(project_id=p.id, user_id=user.id, roles=['ProjectAdmin']))
    event(db, user, p.id, 'Создан проект', p)
    db.commit()
    return dump(p)


@app.patch('/api/projects/{pid}')
def project_update(pid: str, data: ProjectInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    if data.start_date > data.end_date:
        fail('Некорректные даты проекта')
    obj = db.get(Project, pid)
    before = dump(obj)
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    event(db, user, pid, 'Изменён проект', obj, before)
    db.commit()
    return dump(obj)


@app.put('/api/projects/{pid}/members')
def member_update(pid: str, data: MemberInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    if data.email:
        target = db.scalar(select(User).where(User.email == data.email.lower()))
        if not target:
            fail('Пользователь с этой почтой не найден')
        data.user_id = target.id
    if not db.get(User, data.user_id) or not data.roles:
        fail('Укажите существующего пользователя и роли')
    if 'ContractorManager' in data.roles and not data.contractor_id:
        fail('Для представителя подрядчика нужна организация')
    if data.contractor_id:
        scoped(db, Contractor, data.contractor_id, pid)
    obj = db.scalar(select(Membership).where(Membership.project_id == pid, Membership.user_id == data.user_id))
    before = dump(obj) if obj else None
    if obj is None:
        obj = Membership(project_id=pid, user_id=data.user_id, roles=[])
        db.add(obj)
    obj.roles, obj.contractor_id = sorted(set(data.roles)), data.contractor_id
    event(db, user, pid, 'Назначены роли', obj, before)
    db.commit()
    return dump(obj)


@app.get('/api/projects/{pid}/works')
def works(pid: str, q: str = '', status: str = '', axis_id: str = '', responsible_id: str = '', contractor_id: str = '',
          start_m: int | None = None, end_m: int | None = None, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=300),
          sort: str = 'code', db: DBSession = Depends(session), user=Depends(current)):
    member = membership(db, user, pid)
    query = select(Work).where(Work.project_id == pid, Work.archived == False)
    if contractor_only(member):
        query = query.where(Work.contractor_id == member.contractor_id)
    if q:
        query = query.where(Work.title.ilike(f'%{q}%') | Work.code.ilike(f'%{q}%'))
    for key, value in [('status', status), ('axis_id', axis_id), ('responsible_id', responsible_id), ('contractor_id', contractor_id)]:
        if value:
            query = query.where(getattr(Work, key) == value)
    if start_m is not None:
        query = query.where(Work.end_m >= start_m)
    if end_m is not None:
        query = query.where(Work.start_m <= end_m)
    count = db.scalar(select(func.count()).select_from(query.subquery()))
    query = query.order_by(getattr(Work, sort) if sort in ('code', 'start_date', 'end_date', 'status') else Work.code)
    return {'items': [work_dump(db, w) for w in db.scalars(query.offset(offset).limit(limit))], 'total': count}


@app.post('/api/projects/{pid}/works')
def create_work(pid: str, data: WorkInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['Planner'])
    validate_work(db, pid, data)
    obj = Work(project_id=pid, **data.model_dump(exclude={'reason', 'version'}))
    db.add(obj)
    event(db, user, pid, 'Создана работа', obj, reason=data.reason)
    db.commit()
    return work_dump(db, obj)


@app.get('/api/projects/{pid}/works/{wid}')
def get_work(pid: str, wid: str, db: DBSession = Depends(session), user=Depends(current)):
    return work_dump(db, access_work(db, user, pid, wid))


@app.put('/api/projects/{pid}/works/{wid}')
def update_work(pid: str, wid: str, data: WorkInput, db: DBSession = Depends(session), user=Depends(current)):
    obj = access_work(db, user, pid, wid, ['Planner'], lock=True)
    if data.version != obj.version:
        fail('Работа уже изменена. Обновите данные перед сохранением', 409)
    validate_work(db, pid, data, amount(db, wid), obj)
    before = dump(obj)
    for key, value in data.model_dump(exclude={'reason', 'version'}).items():
        setattr(obj, key, value)
    obj.version += 1
    event(db, user, pid, 'Изменена работа', obj, before, data.reason)
    db.commit()
    return work_dump(db, obj)


@app.post('/api/projects/{pid}/dependencies')
def dependency_create(pid: str, data: DependencyInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['Planner'])
    # Serialize graph mutations so simultaneous edges cannot introduce a cycle.
    db.scalar(select(Project).where(Project.id == pid).with_for_update())
    obj = add_dependency(db, pid, data)
    event(db, user, pid, 'Добавлена зависимость', obj)
    db.commit()
    return dump(obj)


@app.delete('/api/projects/{pid}/dependencies/{did}')
def dependency_delete(pid: str, did: str, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['Planner'])
    db.scalar(select(Project).where(Project.id == pid).with_for_update())
    obj = scoped(db, Dependency, did, pid)
    event(db, user, pid, 'Удалена зависимость', obj, dump(obj))
    db.delete(obj)
    db.commit()
    return {'ok': True}


@app.post('/api/projects/{pid}/inspections')
def inspection_create(pid: str, data: InspectionInput, db: DBSession = Depends(session), user=Depends(current)):
    work = access_work(db, user, pid, data.work_id, ['RemoteInspector'], lock=True)
    validate_interval(work, data.start_m, data.end_m)
    if not data.observed_at.tzinfo:
        fail('Время наблюдения должно содержать часовой пояс')
    if data.outcome == 'confirmed' and (not data.materials or data.proposed <= 0):
        fail('Подтверждение требует доказательства и положительного объёма')
    if data.outcome == 'deviation' and not data.comment:
        fail('Опишите отклонение')
    if data.outcome == 'inconclusive' and (not data.reason or not data.comment):
        fail('Для недостаточных данных нужны причина и комментарий')
    for link in data.materials:
        asset = scoped(db, Media, link.id, pid, lock=True)
        media_access(db, user, asset)
        if asset.archived:
            fail('Архивный материал нельзя прикрепить')
        if asset.content_type.startswith('video/'):
            if link.from_s is None or asset.duration is None or link.from_s > asset.duration:
                fail('Укажите отметку в пределах длительности видео')
            if link.to_s is not None and not link.from_s <= link.to_s <= asset.duration:
                fail('Некорректные границы видеофрагмента')
        elif link.from_s is not None or link.to_s is not None:
            fail('Временные отметки допустимы только для видео')
    if data.previous_id:
        previous = scoped(db, Inspection, data.previous_id, pid)
        if previous.work_id != work.id:
            fail('Уточнение относится к другой работе')
    obj = Inspection(project_id=pid, author_id=user.id, **data.model_dump(exclude={'materials'}),
                     materials=[link.model_dump() for link in data.materials])
    db.add(obj)
    event(db, user, pid, 'Сохранена проверка', obj, reason=data.comment)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/inspections/{iid}/apply')
def apply_inspection(pid: str, iid: str, data: ReasonInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['Planner'])
    inspection = scoped(db, Inspection, iid, pid)
    work = access_work(db, user, pid, inspection.work_id, ['Planner'], lock=True)
    if inspection.outcome != 'confirmed':
        fail('Можно применить только подтверждённую проверку')
    if work.archived or work.status == 'completed':
        fail('Для принятия факта откройте активную незавершённую работу')
    if db.scalar(select(Progress).where(Progress.inspection_id == iid)):
        fail('Эта проверка уже применена', 409)
    before = work_dump(db, work)
    if amount(db, work.id) + inspection.proposed > work.planned:
        fail('Принятие превысит плановый объём')
    obj = Progress(project_id=pid, work_id=work.id, inspection_id=iid, author_id=user.id, delta=inspection.proposed, reason=data.reason)
    db.add(obj)
    work.version += 1
    event(db, user, pid, 'Принят объём по проверке', obj, before, data.reason, iid)
    db.commit()
    return work_dump(db, work)


@app.post('/api/projects/{pid}/works/{wid}/progress')
def correct_progress(pid: str, wid: str, data: ProgressInput, db: DBSession = Depends(session), user=Depends(current)):
    work = access_work(db, user, pid, wid, ['Planner'], lock=True)
    if work.status == 'completed' or work.archived:
        fail('Сначала повторно откройте работу')
    before = work_dump(db, work)
    if data.delta == 0 or not 0 <= amount(db, wid) + data.delta <= work.planned:
        fail('Корректировка должна быть ненулевой; итог — от нуля до плана')
    obj = Progress(project_id=pid, work_id=wid, author_id=user.id, delta=data.delta, reason=data.reason)
    db.add(obj)
    work.version += 1
    event(db, user, pid, 'Скорректирован принятый объём', obj, before, data.reason)
    db.commit()
    return work_dump(db, work)


@app.post('/api/projects/{pid}/remarks')
def remark_create(pid: str, data: RemarkInput, db: DBSession = Depends(session), user=Depends(current)):
    work = access_work(db, user, pid, data.work_id, ['RemoteInspector'])
    validate_interval(work, data.start_m, data.end_m)
    if data.inspection_id and scoped(db, Inspection, data.inspection_id, pid).work_id != work.id:
        fail('Проверка относится к другой работе')
    if not db.scalar(select(Membership).where(Membership.project_id == pid, Membership.user_id == data.responsible_id)):
        fail('Ответственный не состоит в проекте')
    obj = Remark(project_id=pid, author_id=user.id, **data.model_dump())
    db.add(obj)
    event(db, user, pid, 'Создано замечание', obj)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/remarks/{rid}/reply')
def remark_reply(pid: str, rid: str, data: ReplyInput, db: DBSession = Depends(session), user=Depends(current)):
    member = membership(db, user, pid, ['RemoteInspector', 'ContractorManager'])
    obj = scoped(db, Remark, rid, pid, lock=True)
    access_work(db, user, pid, obj.work_id)
    if 'RemoteInspector' not in member.roles and data.status != 'in_progress':
        fail('Устранение подтверждает только инспектор', 403)
    before = dump(obj)
    obj.status = data.status
    obj.replies = [*obj.replies, {'author_id': user.id, 'text': data.text, 'at': now().isoformat()}]
    event(db, user, pid, 'Ответ на замечание', obj, before, data.text)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/equipment')
def equipment_create(pid: str, data: EquipmentInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    scoped(db, Contractor, data.contractor_id, pid)
    scoped(db, Axis, data.axis_id, pid)
    obj = Equipment(project_id=pid, **data.model_dump())
    db.add(obj)
    event(db, user, pid, 'Добавлена техника', obj)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/cameras')
def camera_create(pid: str, data: CameraInput, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    scoped(db, Equipment, data.equipment_id, pid)
    obj = Camera(project_id=pid, **data.model_dump())
    db.add(obj)
    event(db, user, pid, 'Добавлена камера', obj)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/equipment/{eid}/simulate/{command}')
def simulate(pid: str, eid: str, command: str, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    obj = db.scalar(select(Equipment).where(Equipment.id == eid, Equipment.project_id == pid).with_for_update())
    if not obj:
        fail('Техника не найдена', 404)
    if command not in ('start', 'stop', 'signal_loss', 'reset'):
        fail('Неизвестная команда')
    before = dump(obj)
    obj.sim_state = {'start': 'running', 'stop': 'stopped', 'signal_loss': 'no_signal', 'reset': 'stopped'}[command]
    if command == 'reset':
        obj.sim_step = 0
    event(db, user, pid, f'Симулятор: {command}', obj, before)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/media')
def upload(pid: str, file: UploadFile = File(...), camera_id: str = Form(''), contractor_visible: bool = Form(False),
           captured_at: str = Form(''), db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin', 'Planner', 'RemoteInspector'])
    if camera_id:
        scoped(db, Camera, camera_id, pid)
    allowed = {'image/jpeg': 20, 'image/png': 20, 'video/mp4': 200, 'video/webm': 200}
    if file.content_type not in allowed:
        fail('Поддерживаются JPEG, PNG, MP4 и WebM')
    captured = None
    if captured_at:
        try:
            captured = datetime.fromisoformat(captured_at)
            if not captured.tzinfo:
                raise ValueError()
        except ValueError:
            fail('Время съёмки должно содержать часовой пояс')
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / 'upload'
        checksum, size = hashlib.sha256(), 0
        with path.open('wb') as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > allowed[file.content_type] * 1024 * 1024:
                    fail('Файл превышает допустимый размер')
                checksum.update(chunk)
                out.write(chunk)
        duration = None
        try:
            if file.content_type.startswith('image/'):
                with Image.open(path) as image:
                    if image.format != {'image/jpeg': 'JPEG', 'image/png': 'PNG'}[file.content_type]:
                        raise ValueError()
                    image.verify()
            else:
                head = path.read_bytes()[:32]
                if file.content_type == 'video/mp4' and head[4:8] != b'ftyp':
                    raise ValueError()
                if file.content_type == 'video/webm' and head[:4] != b'\x1aE\xdf\xa3':
                    raise ValueError()
                probe = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)],
                                       capture_output=True, check=True, timeout=20)
                meta = json.loads(probe.stdout)
                if not any(s['codec_type'] == 'video' for s in meta['streams']):
                    raise ValueError()
                duration = float(meta['format']['duration'])
                if duration <= 0:
                    raise ValueError()
        except Exception:
            fail('Содержимое файла повреждено или не соответствует типу')
        key = f'{pid}/{uid()}'
        storage.client().upload_file(str(path), storage.BUCKET, key, ExtraArgs={'ContentType': file.content_type})
    obj = Media(project_id=pid, author_id=user.id, camera_id=camera_id or None,
                name=(file.filename or 'Материал')[:250], content_type=file.content_type, size=size,
                key=key, checksum=checksum.hexdigest(), duration=duration, contractor_visible=contractor_visible, captured_at=captured)
    db.add(obj)
    event(db, user, pid, 'Загружен материал', obj)
    db.commit()
    return dump(obj)


@app.get('/api/media/{mid}/content')
def media_content(mid: str, request: Request, db: DBSession = Depends(session), user=Depends(current)):
    asset = db.get(Media, mid)
    if not asset:
        fail('Материал не найден', 404)
    media_access(db, user, asset)
    params = {'Bucket': storage.BUCKET, 'Key': asset.key}
    headers = {'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline'}
    status = 200
    requested = request.headers.get('range')
    if requested:
        match = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
        if not match:
            return Response(status_code=416, headers={'Content-Range': f'bytes */{asset.size}'})
        start = int(match[1])
        end = min(int(match[2]) if match[2] else asset.size - 1, asset.size - 1)
        if start >= asset.size or start > end:
            return Response(status_code=416, headers={'Content-Range': f'bytes */{asset.size}'})
        params['Range'] = f'bytes={start}-{end}'
        headers['Content-Range'] = f'bytes {start}-{end}/{asset.size}'
        status = 206
    obj = storage.client().get_object(**params)
    headers['Content-Length'] = str(obj['ContentLength'])

    def chunks():
        try:
            while chunk := obj['Body'].read(256 * 1024):
                yield chunk
        finally:
            obj['Body'].close()
    return StreamingResponse(chunks(), status_code=status, media_type=asset.content_type, headers=headers)


@app.post('/api/projects/{pid}/media/{mid}/archive')
def archive_media(pid: str, mid: str, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin', 'Planner', 'RemoteInspector'])
    asset = scoped(db, Media, mid, pid, lock=True)
    if any(any(m['id'] == mid for m in i.materials) for i in db.scalars(select(Inspection).where(Inspection.project_id == pid))):
        fail('Материал связан с проверкой и защищён от удаления или архивирования', 409)
    before = dump(asset)
    asset.archived = True
    event(db, user, pid, 'Архивирован материал', asset, before)
    db.commit()
    return dump(asset)


@app.get('/api/projects/{pid}/state')
def state(pid: str, offset: int = Query(0, ge=0), limit: int = Query(300, ge=1, le=300), db: DBSession = Depends(session), user=Depends(current)):
    member = membership(db, user, pid)
    all_works = list(db.scalars(select(Work).where(Work.project_id == pid)))
    if contractor_only(member):
        all_works = [w for w in all_works if w.contractor_id == member.contractor_id]
    ids = {w.id for w in all_works}
    inspections = list(db.scalars(select(Inspection).where(Inspection.project_id == pid, Inspection.work_id.in_(ids)).order_by(Inspection.created_at.desc())))
    progress = list(db.scalars(select(Progress).where(Progress.project_id == pid, Progress.work_id.in_(ids))))
    applied = {p.inspection_id for p in progress if p.inspection_id}
    material_ids = {m['id'] for i in inspections for m in i.materials}
    assets = list(db.scalars(select(Media).where(Media.project_id == pid).order_by(Media.created_at.desc())))
    if contractor_only(member):
        assets = [m for m in assets if m.contractor_visible and m.id in material_ids]
    equipment = list(db.scalars(select(Equipment).where(Equipment.project_id == pid).order_by(Equipment.inventory)))
    if contractor_only(member):
        equipment = [e for e in equipment if e.contractor_id == member.contractor_id]
    equipment_ids = {e.id for e in equipment}
    events = list(db.scalars(select(Audit).where(Audit.project_id == pid).order_by(Audit.created_at.desc()).limit(300)))
    if contractor_only(member):
        visible_ids = ids | {i.id for i in inspections} | {p.id for p in progress}
        remarks_ids = set(db.scalars(select(Remark.id).where(Remark.work_id.in_(ids))))
        visible_ids |= remarks_ids
        events = [a for a in events if a.entity_id in visible_ids]
    members = list(db.scalars(select(Membership).where(Membership.project_id == pid)))
    users = list(db.scalars(select(User).where(User.id.in_([m.user_id for m in members]))))
    active = [w for w in all_works if not w.archived]
    totals = {s: sum(w.status == s for w in active) for s in ('planned', 'in_progress', 'suspended', 'completed')}
    remarks = list(db.scalars(select(Remark).where(Remark.project_id == pid, Remark.work_id.in_(ids))))
    return {'project': dump(db.get(Project, pid)), 'roles': member.roles,
            'works': [work_dump(db, w) for w in sorted(all_works, key=lambda w: w.code)[offset:offset + limit]],
            'total_works': len(all_works),
            'contractors': [dump(c) for c in db.scalars(select(Contractor).where(Contractor.project_id == pid))],
            'axes': [dump(a) for a in db.scalars(select(Axis).where(Axis.project_id == pid))],
            'members': [dump(m) for m in members] if 'ProjectAdmin' in member.roles else [],
            'users': [{'id': u.id, 'name': u.name, 'email': u.email} for u in users],
            'inspections': [{**dump(i), 'applied': i.id in applied,
                             'review_required': i.id in applied and any(j.previous_id == i.id for j in inspections)} for i in inspections[:limit]],
            'progress': [dump(p) for p in progress[:limit]], 'remarks': [dump(r) for r in remarks[:limit]],
            'media': [dump(m) for m in assets[:limit]],
            'equipment': [{**dump(e), 'point': dump(p) if (p := db.scalar(select(Point).where(Point.equipment_id == e.id).order_by(Point.observed_at.desc()).limit(1))) else None} for e in equipment],
            'cameras': [dump(c) for c in db.scalars(select(Camera).where(Camera.project_id == pid, Camera.equipment_id.in_(equipment_ids)))],
            'dependencies': [dump(d) for d in db.scalars(select(Dependency).where(Dependency.project_id == pid, Dependency.predecessor.in_(ids), Dependency.successor.in_(ids)))],
            'audit': [dump(a) for a in events],
            'summary': {'statuses': totals, 'total': len(active), 'overdue': sum(w.end_date < date.today() and w.status != 'completed' for w in active),
                        'open_remarks': sum(r.status != 'resolved' for r in remarks)}}


@app.post('/api/projects/{pid}/axes')
def axis_create(pid: str, data: dict, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    try:
        start, end = int(data['start_m']), int(data['end_m'])
        if start < 0 or end <= start or not data['name'] or not data['path']:
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        fail('Проверьте название, путь и границы оси')
    obj = Axis(project_id=pid, name=str(data['name'])[:200], path=str(data['path'])[:50], start_m=start, end_m=end)
    db.add(obj)
    event(db, user, pid, 'Создана ось', obj)
    db.commit()
    return dump(obj)


@app.post('/api/projects/{pid}/contractors')
def contractor_create(pid: str, data: dict, db: DBSession = Depends(session), user=Depends(current)):
    membership(db, user, pid, ['ProjectAdmin'])
    if not str(data.get('name', '')).strip():
        fail('Укажите название подрядчика')
    obj = Contractor(project_id=pid, name=str(data['name']).strip()[:200])
    db.add(obj)
    event(db, user, pid, 'Добавлен подрядчик', obj)
    db.commit()
    return dump(obj)
