import asyncio
from sqlalchemy import func, select
from app.modules.audit.models import AuditEvent


async def test_task_stage_replay_conflict_and_effect_are_distinct(client, headers, database):
    task = (await client.post('/patients/1/tasks', headers=headers('doctor'), json={'title':'Уточнить расписание'})).json()
    path = f"/tasks/{task['id']}"
    start = {'status':'in_progress', 'expected_revision':0}
    replies = await asyncio.gather(*[client.patch(path, headers=headers('doctor'), json=start) for _ in range(3)])
    assert all(r.status_code == 200 for r in replies)
    row = replies[0].json()
    assert row['revision'] == 1 and row['started_at'] and not row['completed_at']
    assert (await client.patch(path, headers=headers('doctor'), json={'status':'done','action_result':'Уточнили','expected_revision':0})).status_code == 409
    done = await client.patch(path, headers=headers('doctor'), json={'status':'done','action_result':'Уточнили','expected_revision':1})
    assert done.status_code == 200 and done.json()['verification_status'] == 'pending'
    assert done.json()['revision'] == 2
    assert (await client.post(path+'/verify', headers=headers('doctor'), json={'status':'unknown','comment':'Ждём обратной связи','expected_revision':1})).status_code == 409
    verified = await client.post(path+'/verify', headers=headers('doctor'), json={'status':'unknown','comment':'Ждём обратной связи','expected_revision':2})
    assert verified.status_code == 200 and verified.json()['revision'] == 3
    assert (await client.patch(path, headers=headers('doctor'), json={'status':'in_progress','expected_revision':3})).status_code == 409
    metrics = (await client.get('/analytics/care', headers=headers('doctor'))).json()['tasks']
    assert metrics['open'] == metrics['in_progress'] == 0 and metrics['action_done'] == 1
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'doctor.task_updated')) == 2


async def test_board_is_scoped_search_is_literal_and_cursor_is_bounded(client, headers):
    for title in ('100% уточнить', 'обычная задача', 'ещё задача'):
        assert (await client.post('/patients/1/tasks', headers=headers('doctor'), json={'title':title})).status_code == 201
    await client.post('/patients/2/tasks', headers=headers('doctor2'), json={'title':'Чужой случай'})
    path = '/coordination/board?stage=open&limit=2'
    first = (await client.get(path, headers=headers('doctor'))).json()
    assert first['total'] == 3 and len(first['items']) == 2 and first['next_cursor']
    second = (await client.get(path+f"&before={first['next_cursor']}", headers=headers('doctor'))).json()
    assert len(second['items']) == 1 and second['next_cursor'] is None
    assert not {r['id'] for r in first['items']} & {r['id'] for r in second['items']}
    literal = (await client.get('/coordination/board?q=100%25', headers=headers('doctor'))).json()
    assert literal['total'] == 1 and literal['items'][0]['title'] == '100% уточнить'
    assert all(r['patient_id'] == 1 for r in first['items'] + second['items'])
    for role in ('admin','patient1'):
        assert (await client.get(path, headers=headers(role))).status_code == 403
    assert (await client.get('/coordination/board?stage=invalid', headers=headers('doctor'))).status_code == 422


async def test_patient_directory_keeps_scope_and_exposes_known_work_only(client, headers):
    await client.post('/patients/1/tasks', headers=headers('doctor'), json={'title':'Уточнить время'})
    first = (await client.get('/patients/directory?limit=1',headers=headers('doctor'))).json()
    assert first['total'] == 2 and first['items'][0]['id'] == 1 and first['next_cursor'] == 1
    assert first['items'][0]['open_tasks'] == 1 and first['items'][0]['last_observation_at'] is None
    second = (await client.get('/patients/directory?limit=1&after=1',headers=headers('doctor'))).json()
    assert second['items'][0]['id'] == 3 and second['next_cursor'] is None
    assert (await client.get('/patients/directory?q=%25',headers=headers('doctor'))).json()['total'] == 0
    assert (await client.get('/patients/directory?q=Мария',headers=headers('doctor'))).json()['total'] == 0
    for role in ('admin','patient1'):
        assert (await client.get('/patients/directory',headers=headers(role))).status_code == 403
