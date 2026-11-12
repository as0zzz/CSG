"""Idempotent fictional demo, never overwrites existing project data."""
import hashlib
import os
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from .db import Session
from .models import *
from .security import hash_password
from .services import event
from . import storage

ACCOUNTS = [('admin', 'Алексей Волков', ['ProjectAdmin']), ('planner', 'Мария Соколова', ['Planner']),
            ('inspector', 'Дмитрий Орлов', ['RemoteInspector']), ('customer', 'Анна Белова', ['CustomerViewer']),
            ('contractor', 'Игорь Морозов', ['ContractorManager']), ('other', 'Пользователь другого проекта', ['Planner']),
            ('outsider', 'Пользователь без проекта', [])]


def seed():
    storage.prepare()
    with Session() as db:
        if db.scalar(select(Project).where(Project.code == 'DEMO-01')):
            print('Demo exists: existing data preserved.')
            return
        base = date.fromisoformat(os.getenv('DEMO_BASE_DATE') or date.today().isoformat())
        password = os.environ['DEMO_PASSWORD']
        users = {}
        for key, name, roles in ACCOUNTS:
            u = db.scalar(select(User).where(User.email == f'{key}@demo.local'))
            if not u:
                u = User(email=f'{key}@demo.local', name=name, password=hash_password(password))
                db.add(u)
                db.flush()
            users[key] = u
        p = Project(code='DEMO-01', name='Перегон Северный — Речной', description='Демонстрационный проект железнодорожного строительства. Все данные вымышленные.',
                    start_date=base - timedelta(days=20), end_date=base + timedelta(days=60), demo_base_date=base)
        p2 = Project(code='DEMO-02', name='Южный участок · изолированный проект', start_date=base, end_date=base + timedelta(days=30), demo_base_date=base)
        db.add_all([p, p2]); db.flush()
        contractors = [Contractor(project_id=p.id, name=n) for n in ['СеверСтрой · ДЕМО', 'ПутьСервис · ДЕМО']]
        db.add_all(contractors); db.flush()
        for key, _, roles in ACCOUNTS:
            if key == 'other':
                db.add(Membership(project_id=p2.id, user_id=users[key].id, roles=roles))
            elif roles:
                db.add(Membership(project_id=p.id, user_id=users[key].id, roles=roles,
                                  contractor_id=contractors[0].id if key == 'contractor' else None))
        axes = [Axis(project_id=p.id, name='Северный — Речной', path=str(i + 1), start_m=10000, end_m=14000) for i in range(2)]
        db.add_all(axes); db.flush()
        names = ['Подготовка строительной полосы', 'Разработка земляного полотна', 'Устройство водоотводных канав',
                 'Отсыпка защитного слоя', 'Укладка геотекстиля', 'Балластировка пути', 'Укладка рельсошпальной решётки',
                 'Выправка и рихтовка пути', 'Монтаж кабельных лотков', 'Устройство переходов', 'Монтаж сигнальных опор', 'Благоустройство участка']
        works = []
        statuses = ['completed', 'in_progress', 'in_progress', 'suspended', 'in_progress', 'planned', 'planned', 'planned', 'planned', 'planned', 'planned', 'planned']
        for i, title in enumerate(names):
            w = Work(project_id=p.id, code=f'КСГ-{i+1:03}', title=title, section='Земляное полотно' if i < 5 else 'Верхнее строение пути',
                     contractor_id=contractors[i % 2].id, responsible_id=users['planner'].id, axis_id=axes[i % 2].id,
                     start_m=10000 + (i % 6)*400, end_m=10400 + (i % 6)*400,
                     start_date=base + timedelta(days=i*3 - 20), end_date=base + timedelta(days=i*3 - 7),
                     actual_start=base-timedelta(days=19-i) if i < 5 else None,
                     actual_end=base-timedelta(days=8) if i == 0 else None,
                     unit='м³' if i in (1, 3) else ('шт' if i == 10 else 'м'), planned=1000, status=statuses[i])
            db.add(w); db.flush(); works.append(w)
            event(db, users['planner'], p.id, 'Создана работа', w, reason='Начальный демонстрационный график')
        for i in range(5, 10):
            db.add(Dependency(project_id=p.id, predecessor=works[i].id, successor=works[i+1].id))
        equip = [Equipment(project_id=p.id, name=n, inventory=f'ТХ-{i+1:03}', contractor_id=contractors[i % 2].id, axis_id=axes[i % 2].id)
                 for i, n in enumerate(['Экскаватор ЭК-01', 'Бульдозер БД-02', 'Путеукладчик ПУ-03'])]
        db.add_all(equip); db.flush()
        cams = [Camera(project_id=p.id, equipment_id=equip[i].id, name=f'Камера {i+1} · {equip[i].inventory}') for i in range(2)]
        db.add_all(cams); db.flush()
        assets = []
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(4):
                path = Path(tmp) / f'demo-{i}.png'
                img = Image.new('RGB', (1120, 630), '#eaf0ed')
                draw = ImageDraw.Draw(img)
                font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 28)
                for x in range(0, 1200, 65):
                    draw.polygon([(x, 460), (x+20, 460), (x+180, 170), (x+160, 170)], fill='#8c9b95')
                draw.line([(0, 430), (1120, 210)], fill='#34483d', width=14)
                draw.line([(0, 510), (1120, 290)], fill='#34483d', width=14)
                draw.rectangle((40, 36, 920, 142), fill='#fffefa')
                draw.text((64, 52), 'ДЕМО · СХЕМА УЧАСТКА · НЕ ФОТОСЪЁМКА', fill='#255b48', font=font)
                draw.text((64, 94), f'Северный — Речной · ПК {100+i*4}+00 — {104+i*4}+00', fill='#34483d', font=font)
                img.save(path)
                key = f'{p.id}/demo-{i}.png'
                storage.client().upload_file(str(path), storage.BUCKET, key, ExtraArgs={'ContentType': 'image/png'})
                a = Media(project_id=p.id, author_id=users['inspector'].id, camera_id=cams[i % 2].id, name=f'ДЕМО · схема участка {i+1}.png',
                          content_type='image/png', size=path.stat().st_size, key=key, checksum=hashlib.sha256(path.read_bytes()).hexdigest(),
                          source='synthetic', contractor_visible=True)
                db.add(a); db.flush(); assets.append(a)
            video = Path(tmp) / 'demo.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x244e42:s=960x540:r=24:d=6',
                            '-vf', "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='DEMO - SYNTHETIC RAILWAY SCENE':fontcolor=white:fontsize=30:x=(w-tw)/2:y=80,drawbox=x=80:y=280:w=800:h=12:color=white:t=fill,drawbox=x=80:y=360:w=800:h=12:color=white:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='SIMULATED OBSERVATION':fontcolor=0xb9dacd:fontsize=22:x=(w-tw)/2:y=440",
                            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(video)], check=True)
            key = f'{p.id}/demo.mp4'
            storage.client().upload_file(str(video), storage.BUCKET, key, ExtraArgs={'ContentType': 'video/mp4'})
            a = Media(project_id=p.id, author_id=users['inspector'].id, camera_id=cams[0].id, name='ДЕМО · синтетическое наблюдение.mp4',
                      content_type='video/mp4', size=video.stat().st_size, key=key, checksum=hashlib.sha256(video.read_bytes()).hexdigest(),
                      source='synthetic', duration=6, contractor_visible=True)
            db.add(a); db.flush(); assets.append(a)
        inspections = []
        for i, outcome in enumerate(['confirmed', 'confirmed', 'deviation', 'inconclusive', 'confirmed', 'confirmed']):
            ins = Inspection(project_id=p.id, work_id=works[i].id, author_id=users['inspector'].id,
                             observed_at=now()-timedelta(hours=8-i), start_m=works[i].start_m, end_m=works[i].end_m,
                             outcome=outcome, proposed=1000 if i == 0 else (200 if i == 1 else (100 if outcome == 'confirmed' else 0)),
                             comment=['Подготовка завершена в указанном диапазоне', 'Подтверждена часть объёма', 'Обнаружена неоднородность слоя',
                                      'Недостаточная видимость, нужна выездная проверка', 'Участок доступен для принятия', 'Предварительная фиксация участка'][i],
                             reason='needs_on_site_check' if outcome == 'inconclusive' else '', materials=[{'id': assets[i % 4].id, 'from_s': None, 'to_s': None}])
            db.add(ins); db.flush(); inspections.append(ins)
            event(db, users['inspector'], p.id, 'Сохранена проверка', ins)
            if i < 2:
                prog = Progress(project_id=p.id, work_id=works[i].id, inspection_id=ins.id, author_id=users['planner'].id, delta=ins.proposed, reason='Демонстрационное принятие объёма')
                db.add(prog); event(db, users['planner'], p.id, 'Принят объём по проверке', prog, inspection_id=ins.id)
        for i in range(3):
            w = works[i+2]
            r = Remark(project_id=p.id, work_id=w.id, inspection_id=inspections[i+2].id, author_id=users['inspector'].id,
                       responsible_id=users['contractor'].id, start_m=w.start_m, end_m=w.end_m,
                       title=['Проверить равномерность слоя', 'Выполнить повторную фиксацию', 'Уточнить объём по участку'][i], due_date=base+timedelta(days=i+2))
            db.add(r); event(db, users['inspector'], p.id, 'Создано замечание', r)
        db.add(Point(project_id=p.id, equipment_id=equip[0].id, latitude=55.75, longitude=37.6, offset_m=10200))
        db.commit()
        print('Fictional demo initialized.')


if __name__ == '__main__':
    seed()
