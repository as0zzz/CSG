import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import uuid4
from .test_api import client


def plan_context():
    c = client()
    pid = next(p['id'] for p in c.get('/api/projects').json() if p['code'] == 'KSG-DEMO')
    state = c.get(f'/api/projects/{pid}/schedule').json()
    return c, pid, state


def start_recording(c, p):
    sid = str(uuid4())
    response = c.post(f'/api/projects/{p}/recorder/sessions', json={'id': sid, 'mode': 'test', 'view': {'screen': 'gantt', 'password': 'DO-NOT-STORE'}})
    assert response.status_code == 200, response.text
    return sid


def new_task(c, p, code=None, sid=None):
    payload = {'code': code or 'T-' + uuid4().hex[:6], 'title': 'Тестовая работа', 'start_date': '2026-11-12', 'duration_days': 3}
    headers = {'X-Trace-Session': sid, 'X-Trace-Action': str(uuid4())} if sid else {}
    response = c.post(f'/api/projects/{p}/schedule/tasks', json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return next(t for t in response.json()['tasks'] if t['code'] == payload['code'])


def test_reference_17_days():
    c, p, data = plan_context()
    tasks = {t['code']: t for t in data['tasks'] if len(t['code']) == 1}
    assert len(tasks) == 10
    assert [tasks[k]['duration_days'] for k in 'ABCDEFGHIJ'] == [6, 2, 3, 5, 3, 2, 3, 4, 2, 2]
    assert (date.fromisoformat(tasks['J']['end_date']) - date.fromisoformat(tasks['A']['start_date'])).days + 1 == 17
    assert {next(k for k,v in tasks.items() if v['id'] == p) for p in tasks['J']['predecessor_ids']} == {'F','G','I'}


def test_simple_task_create_update_and_server_trace():
    c,p,data=plan_context();sid=start_recording(c,p);task=new_task(c,p,sid=sid)
    original_start=task['start_date']; task['start_date']='2026-11-15';task['duration_days']=5
    body={k:task[k] for k in ('code','title','start_date','duration_days','predecessor_ids','version')}
    action=str(uuid4())
    response=c.put(f'/api/projects/{p}/schedule/tasks/{task["id"]}',json=body,headers={'X-Trace-Session':sid,'X-Trace-Action':action})
    assert response.status_code==200,response.text
    updated=next(t for t in response.json()['tasks'] if t['id']==task['id'])
    assert updated['end_date']=='2026-11-19'
    assert c.put(f'/api/projects/{p}/schedule/tasks/{task["id"]}',json=body).status_code==409
    events=c.get(f'/api/projects/{p}/recorder/sessions/{sid}/events').json()['items']
    changed=next(e for e in events if e['kind']=='task.update')
    assert changed['origin']=='server' and changed['action_id']==action
    assert next(t for t in changed['before']['tasks'] if t['id']==task['id'])['start_date']==original_start
    assert next(t for t in changed['after']['tasks'] if t['id']==task['id'])['end_date']=='2026-11-19'


def test_cycles_and_invalid_duration_rollback():
    c,p,data=plan_context();a=new_task(c,p);b=new_task(c,p)
    def body(t,preds):return {k:t[k] for k in ('code','title','start_date','duration_days','version')}|{'predecessor_ids':preds}
    assert c.put(f'/api/projects/{p}/schedule/tasks/{b["id"]}',json=body(b,[a['id']])).status_code==200
    assert c.put(f'/api/projects/{p}/schedule/tasks/{a["id"]}',json=body(a,[b['id']])).status_code==422
    for duration in [0,-1,1.5]:
        assert c.put(f'/api/projects/{p}/schedule/tasks/{a["id"]}',json=body(a,[])|{'duration_days':duration}).status_code==422
    assert next(t for t in c.get(f'/api/projects/{p}/schedule').json()['tasks'] if t['id']==a['id'])['predecessor_ids']==[]


def test_recorder_batch_idempotency_scrubbing_and_export():
    c,p,data=plan_context();sid=start_recording(c,p);eid=str(uuid4())
    event={'id':eid,'seq':1,'kind':'task.move','at':'2026-11-12T10:00:00Z','payload':{'task_id':'example','days':2,'password':'secret'},'observation':{'view':'gantt','cookie':'secret'}}
    url=f'/api/projects/{p}/recorder/sessions/{sid}/events'
    for _ in range(2):
        assert c.post(url,json={'events':[event]}).status_code==200
    items=c.get(url).json()['items'];assert len(items)==1
    assert 'password' not in items[0]['payload'] and 'cookie' not in items[0]['observation']
    assert c.post(url,json={'events':[event|{'origin':'server'}]}).status_code==422
    export=c.get(f'/api/projects/{p}/recorder/sessions/{sid}/export')
    lines=[json.loads(line) for line in export.text.splitlines()]
    assert export.status_code==200 and len(lines)==2
    assert lines[0]['schema']=='aksg.behavior.v1' and 'password' not in lines[0]['initial_view']
    assert lines[1]['record_type']=='event' and lines[1]['client_seq']==1
    assert client('customer').get(url).status_code==403
    assert client('other').get(url).status_code==403


def test_recorder_concurrent_retry_and_session_isolation():
    c,p,data=plan_context();sid=start_recording(c,p);eid=str(uuid4())
    body={'events':[{'id':eid,'seq':1,'kind':'ui.click','at':'2026-11-12T10:00:00Z','payload':{'target':'test'}}]}
    def send(_):return client().post(f'/api/projects/{p}/recorder/sessions/{sid}/events',json=body).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:assert list(pool.map(send,range(2)))==[200,200]
    assert c.get(f'/api/projects/{p}/recorder/sessions/{sid}/events').json()['total']==1
    other=start_recording(c,p)
    assert c.post(f'/api/projects/{p}/recorder/sessions/{other}/events',json=body).status_code==409


def test_recalculate_and_readonly():
    c,p,data=plan_context()
    assert client('customer').post(f'/api/projects/{p}/schedule/recalculate',json={'start_date':'2026-11-12','versions':{}}).status_code==403
    current=c.get(f'/api/projects/{p}/schedule').json()
    body={'start_date':'2026-11-12','versions':{t['id']:t['version'] for t in current['tasks']}}
    response=c.post(f'/api/projects/{p}/schedule/recalculate',json=body)
    assert response.status_code==200,response.text
    tasks={t['id']:t for t in response.json()['tasks']}
    for t in tasks.values():
        for pred in t['predecessor_ids']:assert t['start_date']>tasks[pred]['end_date']
    assert c.post(f'/api/projects/{p}/schedule/recalculate',json=body).status_code==409
