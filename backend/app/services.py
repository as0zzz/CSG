from datetime import date
from decimal import Decimal
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, func
from sqlalchemy.inspection import inspect
from .models import (Work, Membership, Contractor, Axis, Dependency, Progress, Inspection, Audit, Media)
from .security import membership, contractor_only


def fail(message, code=422):
    raise HTTPException(code, message)


def dump(obj):
    return jsonable_encoder({c.key: getattr(obj, c.key) for c in inspect(obj).mapper.column_attrs})


def amount(db, work_id):
    return db.scalar(select(func.coalesce(func.sum(Progress.delta), 0)).where(Progress.work_id == work_id)) or Decimal(0)


def work_dump(db, work):
    result = dump(work)
    result['actual'] = float(amount(db, work.id))
    result['warnings'] = []
    for dep in db.scalars(select(Dependency).where(Dependency.successor == work.id)):
        previous = db.get(Work, dep.predecessor)
        if previous and work.start_date < previous.end_date:
            result['warnings'].append(f'Начало раньше окончания {previous.code}')
    return result


def event(db, user, project_id, action, obj, before=None, reason='', inspection_id=None):
    db.flush()
    db.add(Audit(project_id=project_id, author_id=user.id, action=action, entity_id=obj.id,
                 entity_type=obj.__tablename__, before=before, after=dump(obj), reason=reason,
                 inspection_id=inspection_id))


def scoped(db, cls, object_id, project_id, lock=False):
    obj = db.scalar(select(cls).where(cls.id == object_id).with_for_update()) if lock else db.get(cls, object_id)
    if not obj or obj.project_id != project_id:
        fail('Объект не найден в этом проекте', 404)
    return obj


def access_work(db, user, project_id, work_id, roles=None, lock=False):
    member = membership(db, user, project_id, roles)
    query = select(Work).where(Work.id == work_id, Work.project_id == project_id)
    work = db.scalar(query.with_for_update() if lock else query)
    if not work:
        fail('Работа не найдена', 404)
    if contractor_only(member) and member.contractor_id != work.contractor_id:
        fail('Нет доступа к этой работе', 403)
    return work


def validate_work(db, project_id, data, accepted=Decimal(0), previous=None):
    if data.start_date > data.end_date:
        fail('Начало плана позже окончания')
    if data.actual_start and data.actual_end and data.actual_start > data.actual_end:
        fail('Фактическое начало позже окончания')
    scoped(db, Contractor, data.contractor_id, project_id)
    if not db.scalar(select(Membership).where(Membership.project_id == project_id, Membership.user_id == data.responsible_id)):
        fail('Ответственный не состоит в проекте')
    if data.linear:
        if data.axis_id is None or data.start_m is None or data.end_m is None:
            fail('Для линейной работы обязательны ось и диапазон пикетов')
        axis = scoped(db, Axis, data.axis_id, project_id)
        if not axis.start_m <= data.start_m <= data.end_m <= axis.end_m:
            fail('Диапазон вне оси или задан в обратном порядке')
    else:
        if not data.location:
            fail('Укажите место нелинейной работы')
        data.axis_id, data.start_m, data.end_m = None, None, None
    if data.planned < accepted:
        fail('План меньше уже принятого объёма')
    if data.status in ('in_progress', 'completed') and not data.actual_start:
        fail('Нужна фактическая дата начала')
    if data.status == 'completed' and (not data.actual_end or accepted != data.planned):
        fail('Для завершения нужны фактические даты и полный принятый объём')
    if data.actual_end and data.status != 'completed':
        fail('Дата окончания допустима только для завершённой работы')
    if previous and previous.status == 'completed' and data.status != 'completed' and not data.reason:
        fail('Повторное открытие требует причины')
    if previous and data.status == 'in_progress' and previous.status != 'in_progress':
        for dep in db.scalars(select(Dependency).where(Dependency.successor == previous.id)):
            if db.get(Work, dep.predecessor).status != 'completed' and not data.reason:
                fail('Предшественник не завершён. Укажите причину нарушения последовательности')


def validate_interval(work, start, end):
    if work.linear and (start is None or end is None or not work.start_m <= start <= end <= work.end_m):
        fail('Проверяемый диапазон должен находиться внутри работы')


def media_access(db, user, asset):
    member = membership(db, user, asset.project_id)
    if contractor_only(member):
        own = set(db.scalars(select(Work.id).where(Work.project_id == asset.project_id, Work.contractor_id == member.contractor_id)))
        linked = any(i.work_id in own and any(m['id'] == asset.id for m in i.materials)
                     for i in db.scalars(select(Inspection).where(Inspection.project_id == asset.project_id)))
        if not asset.contractor_visible or not linked:
            fail('Материал недоступен подрядчику', 403)
    return member


def add_dependency(db, project_id, data):
    predecessor = scoped(db, Work, data.predecessor, project_id)
    successor = scoped(db, Work, data.successor, project_id)
    if predecessor.id == successor.id:
        fail('Работа не может зависеть от себя')
    edges = list(db.scalars(select(Dependency).where(Dependency.project_id == project_id)))
    if any(e.predecessor == predecessor.id and e.successor == successor.id for e in edges):
        fail('Такая зависимость уже существует', 409)
    stack, seen = [successor.id], set()
    while stack:
        node = stack.pop()
        if node == predecessor.id:
            fail('Зависимость создаёт цикл')
        if node not in seen:
            seen.add(node)
            stack.extend(e.successor for e in edges if e.predecessor == node)
    dep = Dependency(project_id=project_id, predecessor=predecessor.id, successor=successor.id)
    db.add(dep)
    return dep
