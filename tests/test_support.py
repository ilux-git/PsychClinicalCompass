from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.adherence.models import AdherenceReport
from app.modules.audit.models import AuditEvent


async def test_self_report_replay_and_unknown_outcome(client, headers, database):
    initial = (await client.get('/patients/1/adherence', headers=headers('doctor'))).json()
    assert initial == {'reports': [], 'observation_status': 'unknown'}
    payload = {'recommendation':'Вести дневник', 'status':'unknown', 'reason':'Не помню, записывал ли сегодня',
               'client_request_id':str(uuid4())}
    first = await client.post('/adherence/reports', headers=headers('patient1'), json=payload)
    retry = await client.post('/adherence/reports', headers=headers('patient1'), json=payload)
    assert first.status_code == retry.status_code == 201 and first.json() == retry.json()
    assert (await client.post('/adherence/reports', headers=headers('patient1'), json={**payload,'status':'not_followed'})).status_code == 409
    assert (await client.post('/adherence/reports', headers=headers('doctor'), json=payload)).status_code == 403
    summary = (await client.get('/analytics/engagement', headers=headers('doctor'))).json()['adherence']
    assert summary['statuses'] == {'unknown':1} and summary['patients_without_reports'] == 1
    assert summary['reasons'][0]['text'] == payload['reason']
    assert (await client.get('/patients/1/adherence', headers=headers('patient2'))).status_code == 404
    async with database() as session:
        assert await session.scalar(select(func.count(AdherenceReport.id))) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'adherence.reported')) == 1


async def test_private_note_source_and_task_scope(client, headers):
    msg = (await client.post('/conversations/2/messages', headers=headers('patient2'), json={'text':'Foreign source'})).json()
    source = {'text':'Приватная заметка', 'source_type':'message', 'source_id':msg['id']}
    assert (await client.post('/patients/1/notes', headers=headers('doctor'), json=source)).status_code == 404
    note = await client.post('/patients/1/notes', headers=headers('doctor'), json={'text':'Что обсудить'})
    assert note.status_code == 201 and note.json()['source_type'] == 'manual'
    assert (await client.get('/patients/1/notes', headers=headers('patient1'))).status_code == 403
    assert (await client.post('/patients/1/notes', headers=headers('doctor'), json={**source,'source_id':None})).status_code == 422
    task = (await client.post('/patients/1/tasks', headers=headers('doctor'), json={'title':'Обсудить удобное время'})).json()
    path = f"/tasks/{task['id']}"
    assert (await client.patch(path, headers=headers('doctor2'), json={'status':'done'})).status_code == 404
    assert (await client.patch(path, headers=headers('patient1'), json={'status':'done'})).status_code == 403
    assert (await client.patch(path, headers=headers('doctor'), json={'status':'done'})).status_code == 422
    completed = (await client.patch(path, headers=headers('doctor'), json={'status':'done', 'action_result':'Удобное время согласовано'})).json()
    assert completed['status'] == 'done' and completed['completed_at'] is not None
    assert (await client.patch(path, headers=headers('doctor'), json={'status':'done'})).json() == completed
    timeline = (await client.get('/patients/1/timeline', headers=headers('doctor'))).json()
    assert sum(e['event_type'] == 'doctor.task_updated' for e in timeline) == 1
    assert all(e['actor_id'] is not None for e in timeline)
    assert (await client.patch(path, headers=headers('doctor'), json={'status':'open'})).json()['completed_at'] is None


@pytest.mark.parametrize('compass,mis,state,code', [(True,True,'ok',200),(True,False,'degraded',200),(False,True,'unavailable',503)])
async def test_health_reports_dependency_failure(client, monkeypatch, compass, mis, state, code):
    import app.main as main
    async def pings():
        return {'compass':compass,'mis':mis}
    monkeypatch.setattr(main, 'ping_databases', pings)
    response = await client.get('/health')
    assert response.status_code == code
    assert response.json() == {'status':state,'compass_db':compass,'mis_db':mis,'mode':'synthetic_demo'}


async def test_mis_failure_is_explicit_and_compass_card_survives(client, headers, monkeypatch):
    import app.modules.patients.router as router
    class Unavailable:
        async def __aenter__(self):
            raise OSError('Injected MIS outage')
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr(router, 'async_session_mis', lambda:Unavailable())
    response = await client.get('/patients/1', headers=headers('doctor'))
    assert response.status_code == 200
    assert response.json()['mis']['status'] == 'unavailable' and response.json()['id'] == 1


async def test_database_role_overrides_stale_token_claims(client, accounts):
    from app.core.security import create_access_token
    forged_role = {'Authorization':'Bearer '+create_access_token(accounts['patient1'].id, 'doctor')}
    assert (await client.get('/analytics/engagement', headers=forged_role)).status_code == 403
    assert [p['id'] for p in (await client.get('/patients', headers=forged_role)).json()] == [1]


async def test_conflicting_mis_mapping_does_not_read_another_source(client, headers, database):
    from app.modules.patients.models import PatientMapping
    async with database() as session:
        mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == 1))
        mapping.mis_id = 999
        await session.commit()
    card = (await client.get('/patients/1', headers=headers('doctor'))).json()
    assert card['mis']['status'] == 'mapping_conflict' and 'full_name' not in card['mis']
