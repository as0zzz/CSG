"""Add the user's A–J reference as a separate editable schedule. Preserve existing data."""
import os
from datetime import date, timedelta
from sqlalchemy import select
from .db import Session
from .models import Project, User, Membership, Contractor, Work, Dependency, Axis


def seed_reference():
    with Session() as db:
        if db.scalar(select(Project).where(Project.code == 'KSG-DEMO')):
            return
        users = list(db.scalars(select(User)))
        planner = next((u for u in users if u.email == 'planner@demo.local'), None)
        if not planner:
            return
        start = date.fromisoformat(os.getenv('DEMO_BASE_DATE') or date.today().isoformat())
        project = Project(code='KSG-DEMO', name='Учебный график A–J', description='Пример по схеме пользователя: 10 работ, 17 календарных дней.',
                          start_date=start, end_date=start + timedelta(days=16), demo_base_date=start)
        db.add(project); db.flush()
        contractor = Contractor(project_id=project.id, name='Учебный проект')
        db.add(contractor); db.flush()
        for u in users:
            if u.email in ('planner@demo.local', 'admin@demo.local', 'customer@demo.local', 'inspector@demo.local'):
                roles = ['Planner'] if u.email.startswith('planner') else ['ProjectAdmin'] if u.email.startswith('admin') else ['CustomerViewer']
                db.add(Membership(project_id=project.id, user_id=u.id, roles=roles))
        definitions = [('A',6,[]),('B',2,[]),('C',3,['A']),('D',5,['A']),('E',3,['A']),
                       ('F',2,['C']),('G',3,['D']),('H',4,['B','E']),('I',2,['H']),('J',2,['F','G','I'])]
        names = ['Подготовительные работы','Доставка материалов','Разработка участка','Устройство основания','Подготовка коммуникаций',
                 'Приёмка участка','Монтаж конструкций','Прокладка коммуникаций','Испытания','Завершение этапа']
        tasks = {}
        for (code, duration, predecessors), title in zip(definitions, names):
            begin = max([tasks[p].end_date + timedelta(days=1) for p in predecessors], default=start)
            work = Work(project_id=project.id, code=code, title=title, responsible_id=planner.id, contractor_id=contractor.id,
                        linear=False, location='Учебный КСГ', unit='шт', planned=1, start_date=begin, end_date=begin + timedelta(days=duration - 1))
            db.add(work); db.flush(); tasks[code] = work
            for p in predecessors:
                db.add(Dependency(project_id=project.id, predecessor=tasks[p].id, successor=work.id))
        db.commit()
        print('A-J reference schedule initialized: 10 tasks, 17 calendar days.')


def seed_construction():
    with Session() as db:
        if db.scalar(select(Project).where(Project.code == 'KSG-CONSTRUCTION')):
            return
        users = list(db.scalars(select(User)))
        planner = next((u for u in users if u.email == 'planner@demo.local'), None)
        if not planner:
            return
        start = date.fromisoformat(os.getenv('DEMO_BASE_DATE') or date.today().isoformat())
        project = Project(code='KSG-CONSTRUCTION', name='Строительство железнодорожного пути · ПК 100–120',
                          description='Демонстрационный график строительства участка пути: земляное полотно, водоотвод, верхнее строение пути, СЦБ и приёмка.',
                          start_date=start, end_date=start, demo_base_date=start)
        db.add(project); db.flush()
        contractor = Contractor(project_id=project.id, name='Подрядчик строительства пути')
        axis = Axis(project_id=project.id, name='Строительный участок ПК 100–120', path='1', start_m=10000, end_m=12000)
        db.add_all([contractor, axis]); db.flush()
        for u in users:
            if u.email in ('planner@demo.local', 'admin@demo.local', 'customer@demo.local', 'inspector@demo.local'):
                roles = ['Planner'] if u.email.startswith('planner') else ['ProjectAdmin'] if u.email.startswith('admin') else ['CustomerViewer']
                db.add(Membership(project_id=project.id, user_id=u.id, roles=roles))
        definitions = [
            ('01', 'Геодезическая разбивка участка', 2, [], 'Подготовка', 'м', 2000),
            ('02', 'Подготовка строительной площадки', 3, ['01'], 'Подготовка', 'м²', 10000),
            ('03', 'Разработка земляного полотна', 6, ['02'], 'Земляные работы', 'м³', 12000),
            ('04', 'Устройство водоотводных канав', 4, ['03'], 'Земляные работы', 'м', 2000),
            ('05', 'Укладка геотекстиля', 3, ['03', '04'], 'Земляные работы', 'м²', 12000),
            ('06', 'Отсыпка защитного слоя', 5, ['05'], 'Земляные работы', 'м³', 6000),
            ('07', 'Устройство балластной призмы', 4, ['06'], 'Верхнее строение пути', 'м³', 4500),
            ('08', 'Укладка рельсошпальной решётки', 5, ['07'], 'Верхнее строение пути', 'м', 2000),
            ('09', 'Сварка рельсовых стыков', 3, ['08'], 'Верхнее строение пути', 'шт', 40),
            ('10', 'Монтаж кабельных лотков', 4, ['06'], 'СЦБ и связь', 'м', 2000),
            ('11', 'Прокладка кабелей СЦБ и связи', 4, ['10'], 'СЦБ и связь', 'м', 2200),
            ('12', 'Выправка, подбивка и рихтовка пути', 3, ['09'], 'Верхнее строение пути', 'м', 2000),
            ('13', 'Контроль геометрии пути', 2, ['12'], 'Контроль и приёмка', 'м', 2000),
            ('14', 'Испытания СЦБ и связи', 2, ['11'], 'Контроль и приёмка', 'шт', 1),
            ('15', 'Исполнительная съёмка и приёмка участка', 3, ['13', '14'], 'Контроль и приёмка', 'м', 2000),
        ]
        tasks = {}
        for code, title, duration, predecessors, section, unit, volume in definitions:
            begin = max([tasks[p].end_date + timedelta(days=1) for p in predecessors], default=start)
            work = Work(project_id=project.id, code=code, title=title, section=section,
                        responsible_id=planner.id, contractor_id=contractor.id, linear=True,
                        axis_id=axis.id, start_m=10000, end_m=12000, location='ПК 100–120, путь 1',
                        unit=unit, planned=volume, start_date=begin, end_date=begin + timedelta(days=duration-1))
            db.add(work); db.flush(); tasks[code] = work
            for predecessor in predecessors:
                db.add(Dependency(project_id=project.id, predecessor=tasks[predecessor].id, successor=work.id))
        project.end_date = max(w.end_date for w in tasks.values())
        db.commit()
        print('Construction schedule initialized: 15 railway construction activities.')


def seed_plan():
    seed_reference()
    seed_construction()


if __name__ == '__main__':
    seed_plan()
