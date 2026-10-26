import asyncio
from datetime import datetime, timezone
import json
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.modules.audit.models import AuditEvent
from app.modules.access.models import User, UserRole
from app.modules.notes.models import DoctorNote, DoctorTask
from app.modules.patients.models import PatientMapping
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission


@pytest_asyncio.fixture
async def example(accounts, database):
    async with database() as session:
        survey=Survey(doctor_id=accounts['doctor'].id,title='Затруднения',version=2,
            questions=[{'id':'barrier','prompt':'Что мешает?','kind':'text'}],published_at=datetime.now(timezone.utc))
        session.add(survey)
        await session.flush()
        assignment=SurveyAssignment(survey_id=survey.id,patient_id=1,client_request_id=str(uuid4()),status='completed')
        session.add(assignment)
        await session.flush()
        submission=SurveySubmission(assignment_id=assignment.id,patient_id=1,answers={'barrier':'Не подходит время визита'})
        session.add(submission)
        await session.flush()
        task=DoctorTask(patient_id=1,doctor_id=accounts['doctor'].id,title='Обсудить время визита',
            source_type='survey_submission',source_id=submission.id,kind='organization')
        coordinator=User(username='coordinator',display_name='Координатор',role=UserRole.coordinator,
            hashed_password=accounts['doctor'].hashed_password)
        session.add_all([task,coordinator,DoctorNote(patient_id=1,doctor_id=accounts['doctor'].id,text='PRIVATE NOTE NEVER EXPORT')])
        await session.commit()
        accounts['coordinator']=coordinator
        return {'task_id':task.id,'source_id':submission.id,'survey_id':survey.id,'revision':task.revision}


def preview_path(example, patient_id=1):
    return f"/patients/{patient_id}/tasks/{example['task_id']}/emr-preview"


async def preview(client, headers, example):
    response=await client.get(preview_path(example),headers=headers('doctor'))
    assert response.status_code==200
    return response.json()


def approval_payload(data, request_id=None):
    return {'task_id':data['task_id'],'expected_task_revision':data['task_revision'],
        'content_hash':data['content_hash'],'confirmed':True,'client_request_id':request_id or str(uuid4())}


async def approved(client, headers, example):
    data=await preview(client,headers,example)
    payload=approval_payload(data)
    response=await client.post('/patients/1/emr-documents',headers=headers('doctor'),json=payload)
    assert response.status_code==201
    return response.json(),payload


def transfer_path(document):
    return f"/patients/1/emr-documents/{document['id']}/simulate-transfer"


async def counts(database):
    from app.modules.integration.emr_models import EmrDemoDocument, EmrDemoReceipt
    async with database() as session:
        return tuple([await session.scalar(select(func.count()).select_from(model)) for model in (EmrDemoDocument,EmrDemoReceipt)])


async def event_count(database, kind):
    async with database() as session:
        return await session.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.event_type==kind))


async def test_preview_is_read_only_and_keeps_original_answer_action_and_verification_separate(client, headers, example, database):
    data=await preview(client,headers,example)
    payload=data['content']
    assert payload['source']['answers']=={'barrier':'Не подходит время визита'}
    assert payload['source']['survey']['version']==2
    assert payload['care']['status']=='open' and payload['care']['verification']['status']=='pending'
    assert payload['signature']=={'kind':'simulation','legally_valid':False}
    assert payload['synthetic'] is True and payload['patient_reference']=={'system':'synthetic-mis','id':1}
    assert 'PRIVATE NOTE' not in json.dumps(data)
    assert data['latest_document'] is None
    assert await counts(database)==(0,0)


@pytest.mark.parametrize('actor,status',[('admin',403),('patient1',403),('doctor2',404),('coordinator',403)])
async def test_preview_approval_and_transfer_keep_role_and_patient_scope(client, headers, example, actor, status):
    data=await preview(client,headers,example)
    assert (await client.get(preview_path(example),headers=headers(actor))).status_code==status
    assert (await client.post('/patients/1/emr-documents',headers=headers(actor),json=approval_payload(data))).status_code==status
    assert (await client.post('/patients/1/emr-documents/999/simulate-transfer',headers=headers(actor),
        json={'content_hash':data['content_hash'],'confirmed':True})).status_code==status


@pytest.mark.parametrize('mapping_state',['missing','conflict'])
async def test_missing_or_conflicting_mis_mapping_prevents_preview(client, headers, example, database, mapping_state):
    async with database() as session:
        mapping=await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id==1))
        if mapping_state=='missing': await session.delete(mapping)
        else: mapping.mis_id=999
        await session.commit()
    assert (await client.get(preview_path(example),headers=headers('doctor'))).status_code==409


async def test_other_patient_source_and_private_note_cannot_be_exported(client, headers, example, database):
    async with database() as session:
        submission=await session.get(SurveySubmission,example['source_id'])
        submission.patient_id=2
        await session.commit()
    assert (await client.get(preview_path(example),headers=headers('doctor'))).status_code==404
    async with database() as session:
        task=await session.get(DoctorTask,example['task_id'])
        task.source_type='doctor_note'
        task.source_id=await session.scalar(select(DoctorNote.id))
        await session.commit()
    assert (await client.get(preview_path(example),headers=headers('doctor'))).status_code==422


@pytest.mark.parametrize('confirmed',[False,1,'true'])
async def test_approval_requires_explicit_boolean_confirmation(client, headers, example, database, confirmed):
    data=await preview(client,headers,example)
    payload={**approval_payload(data),'confirmed':confirmed}
    assert (await client.post('/patients/1/emr-documents',headers=headers('doctor'),json=payload)).status_code==422
    assert await counts(database)==(0,0)


async def test_stale_preview_is_not_approved(client, headers, example, database):
    data=await preview(client,headers,example)
    async with database() as session:
        task=await session.get(DoctorTask,example['task_id'])
        task.title='Новое действие'
        task.revision+=1
        await session.commit()
    assert (await client.post('/patients/1/emr-documents',headers=headers('doctor'),json=approval_payload(data))).status_code==409
    assert await counts(database)==(0,0)


async def test_concurrent_approval_retries_create_one_document_and_author_event(client, headers, example, database, accounts):
    data=await preview(client,headers,example)
    payload=approval_payload(data)
    responses=await asyncio.gather(*(client.post('/patients/1/emr-documents',headers=headers('doctor'),json=payload) for _ in range(4)))
    assert all(r.status_code==201 for r in responses)
    documents=[r.json() for r in responses]
    assert len({d['id'] for d in documents})==1
    assert all(d['approved_by']==accounts['doctor'].id and d['approved_at'] and d['status']=='approved' for d in documents)
    assert sum(not d['replayed'] for d in documents)==1
    assert await counts(database)==(1,0)
    assert await event_count(database,'emr_demo.approved')==1
    changed={**payload,'content_hash':'0'*64}
    assert (await client.post('/patients/1/emr-documents',headers=headers('doctor'),json=changed)).status_code==409


async def test_receiver_requires_approved_exact_content_then_retries_one_receipt(client, headers, example, database):
    document,_=await approved(client,headers,example)
    assert document['receipt'] is None
    assert (await client.post(transfer_path(document),headers=headers('doctor'),json={'content_hash':'0'*64,'confirmed':True})).status_code==409
    payload={'content_hash':document['content_hash'],'confirmed':True}
    responses=await asyncio.gather(*(client.post(transfer_path(document),headers=headers('doctor'),json=payload) for _ in range(4)))
    assert all(r.status_code==200 for r in responses)
    result=[r.json() for r in responses]
    assert len({r['receipt']['id'] for r in result})==1
    assert all(r['status']=='accepted_by_simulator' and r['receipt']['external_delivery'] is False for r in result)
    assert await counts(database)==(1,1)
    assert await event_count(database,'emr_demo.accepted')==1
    latest=(await preview(client,headers,example))['latest_document']
    assert latest['id']==document['id'] and latest['status']=='accepted_by_simulator'


async def test_change_after_approval_requires_new_preview_before_transfer(client, headers, example, database):
    document,_=await approved(client,headers,example)
    async with database() as session:
        task=await session.get(DoctorTask,example['task_id'])
        task.status='done';task.action_result='Уточнили удобное время';task.revision+=1
        await session.commit()
    response=await client.post(transfer_path(document),headers=headers('doctor'),json={'content_hash':document['content_hash'],'confirmed':True})
    assert response.status_code==409
    assert await counts(database)==(1,0)
    latest=(await preview(client,headers,example))['latest_document']
    assert latest['is_current'] is False and latest['status']=='approved'


async def test_repeated_old_approval_remains_a_historical_snapshot_after_task_changes(client, headers, example, database):
    document,payload=await approved(client,headers,example)
    async with database() as session:
        task=await session.get(DoctorTask,example['task_id'])
        task.title='Уточнённое действие';task.revision+=1
        await session.commit()
    response=await client.post('/patients/1/emr-documents',headers=headers('doctor'),json=payload)
    assert response.status_code==201
    old=response.json()
    assert old['id']==document['id'] and old['replayed'] is True and old['is_current'] is False
    assert old['content']==document['content'] and await counts(database)==(1,0)


async def test_repeated_accepted_receipt_does_not_retransfer_updated_task(client, headers, example, database):
    document,_=await approved(client,headers,example)
    payload={'content_hash':document['content_hash'],'confirmed':True}
    first=await client.post(transfer_path(document),headers=headers('doctor'),json=payload)
    assert first.status_code==200
    async with database() as session:
        task=await session.get(DoctorTask,example['task_id'])
        task.title='Последующее действие';task.revision+=1
        await session.commit()
    response=await client.post(transfer_path(document),headers=headers('doctor'),json=payload)
    assert response.status_code==200
    old=response.json()
    assert old['receipt']['id']==first.json()['receipt']['id'] and old['is_current'] is False
    assert old['content']==document['content'] and await counts(database)==(1,1)
    assert await event_count(database,'emr_demo.accepted')==1


async def test_approval_key_cannot_be_reused_for_another_patient(client, headers, example, database):
    _,payload=await approved(client,headers,example)
    response=await client.post('/patients/3/emr-documents',headers=headers('doctor'),json=payload)
    assert response.status_code==409 and 'content' not in response.json()
    assert await counts(database)==(1,0)


async def test_receiver_failure_retains_approval_and_can_be_retried(client, headers, example, database, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    from app.modules.integration import emr_router
    document,_=await approved(client,headers,example)
    original=emr_router.accept_by_simulator
    async def unavailable(*_): raise SQLAlchemyError('simulated receiver failure')
    monkeypatch.setattr(emr_router,'accept_by_simulator',unavailable)
    payload={'content_hash':document['content_hash'],'confirmed':True}
    assert (await client.post(transfer_path(document),headers=headers('doctor'),json=payload)).status_code==503
    assert await counts(database)==(1,0)
    monkeypatch.setattr(emr_router,'accept_by_simulator',original)
    assert (await client.post(transfer_path(document),headers=headers('doctor'),json=payload)).status_code==200
    assert await counts(database)==(1,1)


async def test_approval_and_receiver_are_atomic_with_their_audit_events(client, headers, example, database, monkeypatch):
    from app.modules.integration import emr_router
    data=await preview(client,headers,example)
    original=emr_router.record_event
    def broken_audit(*_,**__): raise RuntimeError('simulated audit failure')
    monkeypatch.setattr(emr_router,'record_event',broken_audit)
    with pytest.raises(RuntimeError,match='simulated audit failure'):
        await client.post('/patients/1/emr-documents',headers=headers('doctor'),json=approval_payload(data))
    assert await counts(database)==(0,0)
    monkeypatch.setattr(emr_router,'record_event',original)
    document,_=await approved(client,headers,example)
    monkeypatch.setattr(emr_router,'record_event',broken_audit)
    with pytest.raises(RuntimeError,match='simulated audit failure'):
        await client.post(transfer_path(document),headers=headers('doctor'),json={'content_hash':document['content_hash'],'confirmed':True})
    assert await counts(database)==(1,0)
