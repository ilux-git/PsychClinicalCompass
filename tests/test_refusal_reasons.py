import json
from uuid import uuid4


async def test_refusal_reasons_follow_current_doctor_decision_not_silence(client,headers):
    initial=(await client.get('/analytics/care',headers=headers('doctor'))).json()['refusal_reasons']
    assert initial['patients']==0 and initial['with_specific_reason']==0
    payload={'status':'refused','reason':'Приватное основание: пациент сообщил о цене',
             'reason_category':'financial','client_request_id':str(uuid4()),'expected_revision':0}
    row=(await client.post('/patients/1/treatment-status',headers=headers('doctor'),json=payload)).json()
    assert row['reason_category']=='financial'
    assert (await client.post('/patients/1/treatment-status',headers=headers('doctor'),json=payload)).json()['replayed']
    assert (await client.post('/patients/1/treatment-status',headers=headers('doctor'),json={**payload,'reason_category':'time'})).status_code==409
    summary=(await client.get('/analytics/care',headers=headers('doctor'))).json()['refusal_reasons']
    assert summary['patients']==summary['with_specific_reason']==1
    assert next(c for c in summary['categories'] if c['code']=='financial')['patients']==1
    assert not summary['inferred_from_nonresponse']
    assert (await client.get('/analytics/care',headers=headers('doctor2'))).json()['refusal_reasons']['patients']==0
    # A new current decision changes the cohort; the old reason remains in history.
    changed=await client.post('/patients/1/treatment-status',headers=headers('doctor'),json={
        'status':'in_progress','reason':'Синтетическое продолжение','client_request_id':str(uuid4()),'expected_revision':row['revision']})
    assert changed.status_code==201
    assert (await client.get('/analytics/care',headers=headers('doctor'))).json()['refusal_reasons']['patients']==0
    history=(await client.get('/patients/1/care',headers=headers('doctor'))).json()['history']
    assert history[1]['reason_category']=='financial' and history[0]['reason_category'] is None


async def test_uncategorized_refusal_is_unknown_and_admin_receives_no_reason_text(client,headers):
    await client.post('/patients/1/treatment-status',headers=headers('doctor'),json={
        'status':'refused','reason':'DOCTOR_PRIVATE_REASON','client_request_id':str(uuid4()),'expected_revision':0})
    policy=(await client.get('/admin/privacy-policy',headers=headers('admin'))).json()
    await client.put('/admin/privacy-policy',headers=headers('admin'),json={
        'min_group_size':1,'reason':'Синтетическая проверка','expected_revision':policy['revision'],'client_request_id':str(uuid4())})
    report=(await client.get('/analytics/clinic',headers=headers('admin'))).json()
    reasons=report['workflow']['values']['refusal_reasons']
    assert reasons['patients']==1 and reasons['with_specific_reason']==0
    assert next(c for c in reasons['categories'] if c['code']=='unknown')['patients']==1
    assert 'DOCTOR_PRIVATE_REASON' not in json.dumps(report)
    assert 'Иван' not in json.dumps(report,ensure_ascii=False)


async def test_reason_category_cannot_be_unstructured_or_attached_to_other_outcomes(client,headers):
    data={'status':'completed','reason_category':'financial','client_request_id':str(uuid4()),'expected_revision':0}
    assert (await client.post('/patients/1/treatment-status',headers=headers('doctor'),json=data)).status_code==422
    assert (await client.post('/patients/1/treatment-status',headers=headers('doctor'),json={**data,'status':'refused','reason_category':'custom_personal_text'})).status_code==422
    assert (await client.post('/patients/1/treatment-status',headers=headers('patient1'),json={**data,'status':'refused'})).status_code==403
