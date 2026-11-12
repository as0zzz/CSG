import io
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select, func
from app.main import app, simulation_tick
from app.db import Session
from app.models import Project, Work, Inspection, Audit, Progress
from app.seed import seed


def client(role='planner'):
    c = TestClient(app)
    response = c.post('/api/auth/login', json={'email': f'{role}@demo.local', 'password': os.environ['DEMO_PASSWORD']})
    assert response.status_code == 200
    return c


def context(role='planner'):
    c = client(role)
    pid = c.get('/api/projects').json()[0]['id']
    return c, pid, c.get(f'/api/projects/{pid}/state').json()


def payload(state, **values):
    w = state['works'][1]
    result = {k: w[k] for k in ['code','title','section','contractor_id','responsible_id','linear','axis_id','start_m','end_m','location','start_date','end_date','actual_start','actual_end','unit','planned','status','version','archived']}
    result.update(values)
    return result


def fresh_work(**values):
    import uuid
    c, p, s = context()
    f = payload(s, code='ТЕСТ-'+uuid.uuid4().hex[:8], status='in_progress', planned=1000, actual_start=date.today().isoformat(), actual_end=None, **values)
    r = c.post(f'/api/projects/{p}/works', json=f)
    assert r.status_code == 200, r.text
    return c, p, s, r.json()


def confirmed(p, s, w, **values):
    f = {'work_id':w['id'],'observed_at':'2026-11-12T10:00:00+03:00','start_m':w['start_m'],'end_m':w['end_m'],
         'outcome':'confirmed','proposed':100,'materials':[{'id':next(m for m in s['media'] if m['content_type']=='image/png')['id']}], 'comment':'Тестовая фиксация'}
    f.update(values)
    return client('inspector').post(f'/api/projects/{p}/inspections',json=f)


def test_authentication():
    assert TestClient(app).get('/api/projects').status_code == 401
    assert TestClient(app).post('/api/auth/login',json={'email':'planner@demo.local','password':'wrong'}).status_code == 401


def test_picket_validation():
    c,p,s=context()
    for values in [{'axis_id':None},{'start_m':None},{'start_m':15000},{'start_m':12000,'end_m':11000},{'start_m':1.5}]:
        r=c.post(f'/api/projects/{p}/works',json=payload(s,code='BAD',**values))
        assert r.status_code == 422, r.text


def test_roles_and_project_isolation():
    c,p,s=context(); w=s['works'][0]
    for role in ['inspector','customer','admin','contractor']:
        assert client(role).put(f'/api/projects/{p}/works/{w["id"]}',json=payload(s)).status_code == 403
    for role in ['other','outsider']:
        t=client(role)
        assert t.get(f'/api/projects/{p}/state').status_code == 403
        assert t.get(f'/api/projects/{p}/works/{w["id"]}').status_code == 403
        assert t.get(f'/api/media/{s["media"][0]["id"]}/content').status_code == 403


def test_graph_cycles_duplicates_self_and_cross_project():
    c,p,s=context(); a,b=s['works'][:2]
    path=f'/api/projects/{p}/dependencies'
    assert c.post(path,json={'predecessor':a['id'],'successor':a['id']}).status_code==422
    assert c.post(path,json={'predecessor':a['id'],'successor':b['id']}).status_code==200
    assert c.post(path,json={'predecessor':a['id'],'successor':b['id']}).status_code==409
    assert c.post(path,json={'predecessor':b['id'],'successor':a['id']}).status_code==422
    with Session() as db:
        other=db.scalar(select(Project).where(Project.code=='DEMO-02'))
        foreign=Work(project_id=other.id,**{k:v for k,v in payload(s,code='FOREIGN').items() if k!='version'})
        # Reference fields intentionally point to the other project: endpoint must reject the work itself.
        from datetime import date
        for k in ['start_date','end_date','actual_start','actual_end']:
            if getattr(foreign,k):setattr(foreign,k,date.fromisoformat(getattr(foreign,k)))
        db.add(foreign);db.commit();wid=foreign.id
    assert c.post(path,json={'predecessor':wid,'successor':a['id']}).status_code==404


def test_inspection_does_not_mutate_schedule_and_requires_evidence():
    c,p,s,w=fresh_work()
    assert confirmed(p,s,w,materials=[]).status_code==422
    assert confirmed(p,s,w,start_m=w['start_m']-1).status_code==422
    r=confirmed(p,s,w);assert r.status_code==200,r.text
    current=c.get(f'/api/projects/{p}/works/{w["id"]}').json()
    assert current['actual']==0 and current['status']==w['status'] and current['version']==w['version']


def test_concurrent_apply_exactly_once():
    c,p,s,w=fresh_work();ins=confirmed(p,s,w).json()
    def apply(_):return client().post(f'/api/projects/{p}/inspections/{ins["id"]}/apply',json={'reason':'Проверено планировщиком'}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool: codes=sorted(pool.map(apply,range(2)))
    assert codes==[200,409]
    assert c.get(f'/api/projects/{p}/works/{w["id"]}').json()['actual']==100


def test_progress_bounds_and_completion():
    c,p,s,w=fresh_work()
    path=f'/api/projects/{p}/works/{w["id"]}'
    for delta in [-1,1001,0]:
        assert c.post(path+'/progress',json={'delta':delta,'reason':'Корректировка теста'}).status_code==422
    assert c.post(path+'/progress',json={'delta':100,'reason':''}).status_code==422
    ins=confirmed(p,s,w,proposed=1100).json()
    assert c.post(f'/api/projects/{p}/inspections/{ins["id"]}/apply',json={'reason':'Принятие сверх плана'}).status_code==422
    assert c.post(path+'/progress',json={'delta':1000,'reason':'Демонстрационная корректировка'}).status_code==200
    current=c.get(path).json();assert current['status']=='in_progress'
    update=payload({'works':[None,current]},status='completed',actual_end=None)
    assert c.put(path,json=update).status_code==422
    update['actual_end']=date.today().isoformat()
    assert c.put(path,json=update).status_code==200
    assert c.post(path+'/progress',json={'delta':-1,'reason':'Корректировка завершённой'}).status_code==422


def test_version_conflict():
    c,p,s,w=fresh_work(); path=f'/api/projects/{p}/works/{w["id"]}'
    f=payload({'works':[None,w]},title='Изменение 1')
    assert c.put(path,json=f).status_code==200
    assert c.put(path,json=f).status_code==409


def test_upload_range_and_linked_protection():
    c,p,s,w=fresh_work();img=io.BytesIO();Image.new('RGB',(50,50),'green').save(img,format='PNG')
    ins_client=client('inspector')
    r=ins_client.post(f'/api/projects/{p}/media',files={'file':('upload.png',img.getvalue(),'image/png')})
    assert r.status_code==200,r.text
    asset=r.json()
    assert c.get(f'/api/media/{asset["id"]}/content').content==img.getvalue()
    assert c.get(f'/api/media/{asset["id"]}/content',headers={'Range':'bytes=0-9'}).status_code==206
    assert c.get(f'/api/media/{asset["id"]}/content',headers={'Range':'bytes=99999-'}).status_code==416
    assert confirmed(p,s,w,materials=[{'id':asset['id']}]).status_code==200
    assert c.post(f'/api/projects/{p}/media/{asset["id"]}/archive').status_code==409
    assert c.delete(f'/api/media/{asset["id"]}').status_code in (404,405)
    assert ins_client.post(f'/api/projects/{p}/media',files={'file':('fake.png',b'not an image','image/png')}).status_code==422


def test_video_metadata_and_fragments():
    c,p,s,w=fresh_work();video=next(m for m in s['media'] if m['content_type']=='video/mp4')
    content=c.get(f'/api/media/{video["id"]}/content').content
    r=client('inspector').post(f'/api/projects/{p}/media',files={'file':('test.mp4',content,'video/mp4')})
    assert r.status_code==200,r.text
    assert r.json()['duration']==6
    assert confirmed(p,s,w,materials=[{'id':video['id'],'from_s':7}]).status_code==422
    assert confirmed(p,s,w,materials=[{'id':video['id'],'from_s':1,'to_s':4}]).status_code==200


def test_revision_preserves_original_and_requests_review():
    c,p,s,w=fresh_work();ins=confirmed(p,s,w).json()
    assert c.post(f'/api/projects/{p}/inspections/{ins["id"]}/apply',json={'reason':'Принятие проверки'}).status_code==200
    revised=confirmed(p,s,w,previous_id=ins['id'],outcome='inconclusive',proposed=0,reason='needs_clarification',comment='Нужно уточнить').json()
    assert revised['previous_id']==ins['id']
    state=c.get(f'/api/projects/{p}/state').json()
    assert next(i for i in state['inspections'] if i['id']==ins['id'])['review_required']
    assert c.get(f'/api/projects/{p}/works/{w["id"]}').json()['actual']==100


def test_simulator_keeps_schedule_unchanged_and_stale_point_time():
    c,p,s=context('admin');e=s['equipment'][0];wid=s['works'][1]['id']
    before=c.get(f'/api/projects/{p}/works/{wid}').json()
    base=f'/api/projects/{p}/equipment/{e["id"]}/simulate/'
    assert c.post(base+'start').status_code==200
    simulation_tick()
    first=c.get(f'/api/projects/{p}/state').json()['equipment'][0]['point']
    assert first and first['source']=='simulated'
    c.post(base+'signal_loss');simulation_tick()
    second=c.get(f'/api/projects/{p}/state').json()['equipment'][0]['point']
    assert first['observed_at']==second['observed_at']
    assert c.get(f'/api/projects/{p}/works/{wid}').json()==before
    assert client('planner').post(base+'start').status_code==403


def test_contractor_restrictions_and_remark_reply():
    c,p,s=context('contractor')
    assert s['works'] and all(w['contractor_id']==s['works'][0]['contractor_id'] for w in s['works'])
    own=s['remarks'][0]
    path=f'/api/projects/{p}/remarks/{own["id"]}/reply'
    assert c.post(path,json={'status':'resolved','text':'Устранено подрядчиком'}).status_code==403
    assert c.post(path,json={'status':'in_progress','text':'Взяли в работу'}).status_code==200
    assert client('inspector').post(path,json={'status':'resolved','text':'Устранение проверено'}).status_code==200
    planner,_,all_state=context()
    foreign=next(w for w in all_state['works'] if w['contractor_id']!=s['works'][0]['contractor_id'])
    assert c.get(f'/api/projects/{p}/works/{foreign["id"]}').status_code==403


def test_filters_and_summary():
    c,p,s=context();w=s['works'][1]
    response=c.get(f'/api/projects/{p}/works',params={'status':w['status'],'axis_id':w['axis_id'],'responsible_id':w['responsible_id'],'start_m':w['start_m'],'end_m':w['end_m']})
    assert response.status_code==200
    assert any(x['id']==w['id'] for x in response.json()['items'])
    assert all(x['status']==w['status'] and x['axis_id']==w['axis_id'] for x in response.json()['items'])
    assert sum(s['summary']['statuses'].values())==s['summary']['total']


def test_seed_idempotence_and_readonly_audit():
    c,p,s=context();count=len(s['works']);seed()
    assert len(c.get(f'/api/projects/{p}/state').json()['works'])==count
    a=s['audit'][0]
    assert a['author_id'] and a['created_at'] and a['after']
    assert c.put(f'/api/projects/{p}/audit/{a["id"]}',json={}).status_code in (404,405)
