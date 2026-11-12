"""Focused KSG scheduling API and semantic black box. No screen/key recording."""
import json
from datetime import date, datetime, timedelta
from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert
from .db import session, Session
from .models import Work, Project, Dependency, Contractor, Membership, User, TraceSession, TraceEvent, uid
from .schemas import Input
from .security import current, membership, contractor_only
from .services import fail, dump, event

router = APIRouter(prefix='/api/projects/{pid}', tags=['КСГ и чёрный ящик'])


class TaskInput(Input):
    code: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=250)
    start_date: date
    duration_days: int = Field(ge=1, le=3650, strict=True)
    predecessor_ids: list[str] = Field(default_factory=list, max_length=200)
    version: int = Field(default=1, ge=1)


class VersionInput(Input):
    version: int


class RecalculateInput(Input):
    start_date: date
    versions: dict[str, int]


class SessionInput(Input):
    id: UUID
    mode: Literal['human', 'test'] = 'human'
    label: str = Field(default='Рабочая сессия', max_length=150)
    view: dict = Field(default_factory=dict)


class ClientEventInput(Input):
    id: UUID
    seq: int = Field(ge=1)
    kind: str = Field(pattern=r'^[a-z][a-z_.]{1,60}$')
    action_id: UUID | None = None
    at: datetime
    payload: dict = Field(default_factory=dict)
    observation: dict = Field(default_factory=dict)
    result: dict = Field(default_factory=dict)


class BatchInput(Input):
    events: list[ClientEventInput] = Field(max_length=100)


def scrub(value, depth=0):
    """Defense in depth: never persist credentials or arbitrary keystrokes."""
    forbidden = {'password', 'token', 'cookie', 'secret', 'authorization', 'email', 'keys', 'keystrokes'}
    if depth > 8:
        return '[depth limit]'
    if isinstance(value, dict):
        return {str(k)[:100]: scrub(v, depth + 1) for k, v in list(value.items())[:100]
                if not any(word in str(k).lower() for word in forbidden)}
    if isinstance(value, list):
        return [scrub(v, depth + 1) for v in value[:200]]
    if isinstance(value, str):
        return value[:2000]
    return value


def snapshot(db, pid, user):
    member = membership(db, user, pid)
    query = select(Work).where(Work.project_id == pid, Work.archived == False).order_by(Work.code)
    if contractor_only(member):
        query = query.where(Work.contractor_id == member.contractor_id)
    works = list(db.scalars(query))
    ids = {w.id for w in works}
    links = list(db.scalars(select(Dependency).where(Dependency.project_id == pid,
                      Dependency.predecessor.in_(ids), Dependency.successor.in_(ids))))
    tasks = [{'id': w.id, 'code': w.code, 'title': w.title, 'start_date': w.start_date.isoformat(),
              'end_date': w.end_date.isoformat(), 'duration_days': (w.end_date - w.start_date).days + 1,
              'predecessor_ids': [d.predecessor for d in links if d.successor == w.id], 'version': w.version} for w in works]
    return {'schema_version': 1, 'project_id': pid, 'tasks': tasks,
            'links': [{'id': d.id, 'from': d.predecessor, 'to': d.successor} for d in links]}


def topo(tasks, predecessors):
    order, visited, active = [], set(), set()
    def visit(node):
        if node in active:
            fail('Связь создаёт цикл. В сетевом графике не должно быть замкнутых цепочек.')
        if node in visited:
            return
        active.add(node)
        for before in predecessors.get(node, []):
            if before not in tasks:
                fail('Предшественник не найден в этом проекте')
            visit(before)
        active.remove(node)
        visited.add(node)
        order.append(node)
    for node in tasks:
        visit(node)
    return order


def trace_owner(db, user, pid, sid, admin=False):
    member = membership(db, user, pid)
    obj = db.get(TraceSession, sid)
    if not obj or obj.project_id != pid:
        fail('Сессия записи не найдена', 404)
    if obj.user_id != user.id and not (admin and 'ProjectAdmin' in member.roles):
        fail('Эта запись принадлежит другому пользователю', 403)
    return obj


def mutation_context(db, user, pid, request, roles=None):
    membership(db, user, pid, roles or ['Planner'])
    db.scalar(select(Project).where(Project.id == pid).with_for_update())
    before = snapshot(db, pid, user)
    sid = request.headers.get('X-Trace-Session')
    if sid:
        trace = trace_owner(db, user, pid, sid)
    else:
        trace = TraceSession(project_id=pid, user_id=user.id, mode='api', label='Прямое действие через API', initial_state=before)
        db.add(trace); db.flush()
    action_id = request.headers.get('X-Trace-Action')
    if action_id:
        try:
            action_id = str(UUID(action_id))
        except ValueError:
            fail('Некорректный идентификатор действия')
    return trace, action_id, before


def mutation_record(db, user, pid, context, kind, payload, result):
    trace, action_id, before = context
    db.flush()
    after = snapshot(db, pid, user)
    db.add(TraceEvent(session_id=trace.id, project_id=pid, user_id=user.id, origin='server',
                      kind=kind, action_id=action_id, payload=scrub(payload), result=result,
                      before=before, after=after, observation={}))


@router.get('/schedule')
def get_schedule(pid: str, db=Depends(session), user=Depends(current)):
    data = snapshot(db, pid, user)
    member = membership(db, user, pid)
    project = db.get(Project, pid)
    return {**data, 'project': {'id': pid, 'name': project.name, 'code': project.code,
                              'start_date': project.start_date.isoformat()},
            'editable': 'Planner' in member.roles}


def validate_task(db, pid, data, task_id=None):
    tasks = list(db.scalars(select(Work).where(Work.project_id == pid, Work.archived == False)))
    ids = {w.id for w in tasks}
    if len(data.predecessor_ids) != len(set(data.predecessor_ids)):
        fail('Предшественники не должны повторяться')
    if any(p not in ids or p == task_id for p in data.predecessor_ids):
        fail('Предшественник не существует в проекте или работа ссылается на себя')
    if any(w.code == data.code and w.id != task_id for w in tasks):
        fail('Код работы уже используется', 409)
    if not date(2000, 1, 1) <= data.start_date <= date(2100, 1, 1):
        fail('Дата начала должна находиться между 2000 и 2100 годом')
    preds = {w.id: [] for w in tasks}
    for d in db.scalars(select(Dependency).where(Dependency.project_id == pid)):
        if d.successor in preds and d.predecessor in ids:
            preds[d.successor].append(d.predecessor)
    if task_id:
        preds[task_id] = data.predecessor_ids
        topo(ids, preds)


def set_predecessors(db, pid, task_id, predecessors, user):
    existing = {d.predecessor: d for d in db.scalars(select(Dependency).where(Dependency.successor == task_id, Dependency.project_id == pid))}
    for predecessor, d in existing.items():
        if predecessor not in predecessors:
            event(db, user, pid, 'Удалена связь КСГ', d, dump(d))
            db.delete(d)
    db.flush()
    for predecessor in predecessors:
        if predecessor not in existing:
            obj = Dependency(project_id=pid, predecessor=predecessor, successor=task_id)
            db.add(obj)
            event(db, user, pid, 'Добавлена связь КСГ', obj)


class NewProjectInput(Input):
    name: str = Field(min_length=1, max_length=200)
    start_date: date


@router.post('/schedule/new-project')
def new_project(pid: str, data: NewProjectInput, request: Request, db=Depends(session), user=Depends(current)):
    context = mutation_context(db, user, pid, request, ['Planner', 'ProjectAdmin'])
    if not date(2000, 1, 1) <= data.start_date <= date(2100, 1, 1):
        fail('Некорректная дата начала')
    project = Project(code='KSG-' + uid()[:8], name=data.name, start_date=data.start_date,
                      end_date=data.start_date, demo_base_date=data.start_date)
    db.add(project); db.flush()
    db.add(Membership(project_id=project.id, user_id=user.id, roles=['Planner']))
    event(db, user, project.id, 'Создан график КСГ', project)
    mutation_record(db, user, pid, context, 'project.create', data.model_dump(mode='json'), {'ok': True, 'new_project_id': project.id})
    db.commit()
    return {**dump(project), 'roles': ['Planner']}


@router.post('/schedule/tasks')
def create_task(pid: str, data: TaskInput, request: Request, db=Depends(session), user=Depends(current)):
    context = mutation_context(db, user, pid, request)
    validate_task(db, pid, data)
    contractor = db.scalar(select(Contractor).where(Contractor.project_id == pid))
    if not contractor:
        contractor = Contractor(project_id=pid, name='Основной подрядчик')
        db.add(contractor); db.flush()
    work = Work(project_id=pid, code=data.code, title=data.title, start_date=data.start_date,
                end_date=data.start_date + timedelta(days=data.duration_days - 1),
                responsible_id=user.id, contractor_id=contractor.id, linear=False,
                location='Контрольно-сетевой график', unit='шт', planned=1)
    db.add(work); db.flush()
    set_predecessors(db, pid, work.id, data.predecessor_ids, user)
    event(db, user, pid, 'Создана работа КСГ', work)
    mutation_record(db, user, pid, context, 'task.create', data.model_dump(mode='json'), {'task_id': work.id, 'ok': True})
    db.commit()
    return get_schedule(pid, db, user)


@router.put('/schedule/tasks/{wid}')
def update_task(pid: str, wid: str, data: TaskInput, request: Request, db=Depends(session), user=Depends(current)):
    context = mutation_context(db, user, pid, request)
    work = db.scalar(select(Work).where(Work.id == wid, Work.project_id == pid, Work.archived == False).with_for_update())
    if not work:
        fail('Работа не найдена', 404)
    if work.version != data.version:
        fail('График уже изменился. Обновите его и повторите действие.', 409)
    validate_task(db, pid, data, wid)
    before = dump(work)
    work.code, work.title, work.start_date = data.code, data.title, data.start_date
    work.end_date = data.start_date + timedelta(days=data.duration_days - 1)
    work.version += 1
    set_predecessors(db, pid, wid, data.predecessor_ids, user)
    event(db, user, pid, 'Изменена работа КСГ', work, before)
    mutation_record(db, user, pid, context, 'task.update', data.model_dump(mode='json'), {'task_id': wid, 'ok': True})
    db.commit()
    return get_schedule(pid, db, user)


@router.post('/schedule/tasks/{wid}/archive')
def archive_task(pid: str, wid: str, data: VersionInput, request: Request, db=Depends(session), user=Depends(current)):
    context = mutation_context(db, user, pid, request)
    work = db.scalar(select(Work).where(Work.id == wid, Work.project_id == pid, Work.archived == False).with_for_update())
    if not work:
        fail('Работа не найдена', 404)
    if work.version != data.version:
        fail('Устаревшая версия работы', 409)
    before = dump(work)
    work.archived, work.version = True, work.version + 1
    event(db, user, pid, 'Работа убрана из КСГ', work, before)
    mutation_record(db, user, pid, context, 'task.archive', {'task_id': wid}, {'ok': True})
    db.commit()
    return get_schedule(pid, db, user)


@router.post('/schedule/recalculate')
def recalculate(pid: str, data: RecalculateInput, request: Request, db=Depends(session), user=Depends(current)):
    context = mutation_context(db, user, pid, request)
    tasks = list(db.scalars(select(Work).where(Work.project_id == pid, Work.archived == False).with_for_update()))
    if {w.id: w.version for w in tasks} != data.versions:
        fail('Состав или версии работ изменились. Обновите график.', 409)
    ids, preds = {w.id: w for w in tasks}, {w.id: [] for w in tasks}
    for d in db.scalars(select(Dependency).where(Dependency.project_id == pid)):
        if d.predecessor in ids and d.successor in ids:
            preds[d.successor].append(d.predecessor)
    order = topo(ids, preds)
    changed = 0
    for wid in order:
        work = ids[wid]
        duration = (work.end_date - work.start_date).days + 1
        start = max([ids[p].end_date + timedelta(days=1) for p in preds[wid]], default=data.start_date)
        end = start + timedelta(days=duration - 1)
        if (work.start_date, work.end_date) != (start, end):
            before = dump(work)
            work.start_date, work.end_date, work.version = start, end, work.version + 1
            event(db, user, pid, 'Рассчитаны сроки по связям КСГ', work, before)
            changed += 1
    mutation_record(db, user, pid, context, 'schedule.recalculate', data.model_dump(mode='json'), {'ok': True, 'changed_tasks': changed})
    db.commit()
    return get_schedule(pid, db, user)


@router.post('/recorder/sessions')
def create_session(pid: str, data: SessionInput, db=Depends(session), user=Depends(current)):
    membership(db, user, pid)
    sid = str(data.id)
    existing = db.get(TraceSession, sid)
    if existing:
        trace_owner(db, user, pid, sid)
        return dump(existing)
    if len(json.dumps(data.view)) > 16000:
        fail('Слишком большой контекст интерфейса')
    obj = TraceSession(id=sid, project_id=pid, user_id=user.id, label=data.label,
                       mode=data.mode, initial_view=scrub(data.view), initial_state=snapshot(db, pid, user))
    db.add(obj)
    # ON CONFLICT makes concurrent tab reload/retry safe without creating a second session.
    values = {k: getattr(obj, k) for k in ('id', 'project_id', 'user_id', 'label', 'mode', 'initial_view', 'initial_state')}
    db.expunge(obj)
    db.execute(insert(TraceSession).values(**values).on_conflict_do_nothing(index_elements=['id']))
    db.commit()
    return dump(trace_owner(db, user, pid, sid))


@router.post('/recorder/sessions/{sid}/events')
def append_events(pid: str, sid: str, data: BatchInput, db=Depends(session), user=Depends(current)):
    trace_owner(db, user, pid, sid)
    acknowledged = []
    for item in data.events:
        if not item.at.tzinfo:
            fail('Время события должно содержать часовой пояс')
        if len(json.dumps(item.model_dump(mode='json'))) > 65536:
            fail('Размер одного события превышает 64 КБ')
        existing = db.get(TraceEvent, str(item.id))
        if existing and existing.session_id != sid:
            fail('Идентификатор события уже принадлежит другой сессии', 409)
        db.execute(insert(TraceEvent).values(id=str(item.id), session_id=sid, project_id=pid, user_id=user.id,
                    origin='client', kind=item.kind, action_id=str(item.action_id) if item.action_id else None,
                    client_seq=item.seq, client_at=item.at, payload=scrub(item.payload),
                    observation=scrub(item.observation), result=scrub(item.result)).on_conflict_do_nothing(index_elements=['id']))
        stored = db.get(TraceEvent, str(item.id))
        if stored.session_id != sid:
            fail('Идентификатор события уже принадлежит другой сессии', 409)
        acknowledged.append(str(item.id))
    db.commit()
    return {'acknowledged': acknowledged}


@router.get('/recorder/sessions')
def list_sessions(pid: str, db=Depends(session), user=Depends(current)):
    member = membership(db, user, pid)
    query = select(TraceSession).where(TraceSession.project_id == pid)
    if 'ProjectAdmin' not in member.roles:
        query = query.where(TraceSession.user_id == user.id)
    objects = list(db.scalars(query.order_by(TraceSession.created_at.desc()).limit(100)))
    return [{k: v for k, v in {**dump(s), 'event_count': db.scalar(select(func.count()).select_from(TraceEvent).where(TraceEvent.session_id == s.id))}.items()
             if k not in ('initial_state', 'initial_view')} for s in objects]


@router.get('/recorder/sessions/{sid}/events')
def list_events(pid: str, sid: str, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), db=Depends(session), user=Depends(current)):
    trace_owner(db, user, pid, sid, admin=True)
    rows = list(db.scalars(select(TraceEvent).where(TraceEvent.session_id == sid, TraceEvent.ordinal > after).order_by(TraceEvent.ordinal).limit(limit)))
    total = db.scalar(select(func.count()).select_from(TraceEvent).where(TraceEvent.session_id == sid))
    return {'items': [dump(e) for e in rows], 'total': total, 'cursor': rows[-1].ordinal if rows else after}


@router.get('/recorder/sessions/{sid}/export')
def export_session(pid: str, sid: str, db=Depends(session), user=Depends(current)):
    trace = trace_owner(db, user, pid, sid, admin=True)
    header = {'record_type': 'session', 'schema': 'aksg.behavior.v1', **dump(trace)}
    def lines():
        yield json.dumps(header, ensure_ascii=False) + '\n'
        with Session() as read:
            for item in read.scalars(select(TraceEvent).where(TraceEvent.session_id == sid).order_by(TraceEvent.ordinal)).yield_per(100):
                yield json.dumps({'record_type': 'event', 'schema': 'aksg.behavior.v1', **dump(item)}, ensure_ascii=False) + '\n'
    return StreamingResponse(lines(), media_type='application/x-ndjson', headers={'Content-Disposition': f'attachment; filename="ksg-session-{sid}.jsonl"'})
