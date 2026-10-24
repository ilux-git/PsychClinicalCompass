import asyncio
from datetime import date
from uuid import uuid4
import pytest
from sqlalchemy import func, select
from app.modules.adherence.rewards import CATALOG_VERSION, DemoCoupon, ParticipationAward
from app.modules.audit.models import AuditEvent


async def fund(database, amount=150):
    # Explicit synthetic test fixture; production endpoints cannot grant arbitrary points.
    async with database() as session:
        session.add(ParticipationAward(patient_id=1,kind='survey',source_key='test-fixture',policy_version='test-only',points=amount,day=date.today()))
        await session.commit()


async def test_parallel_exchange_cannot_overspend_and_cancel_is_idempotent(client, headers, database):
    await fund(database)
    data = {'offer_id':'visit_5','catalog_version':CATALOG_VERSION,'client_request_id':str(uuid4())}
    replies = await asyncio.gather(*[client.post('/participation/demo-coupons',headers=headers('patient1'),json=data) for _ in range(3)])
    assert all(r.status_code == 201 for r in replies)
    coupon = replies[0].json()
    assert len({r.json()['id'] for r in replies}) == 1 and coupon['simulated'] and coupon['code'].startswith('DEMO-')
    assert (await client.post('/participation/demo-coupons',headers=headers('patient1'),json={**data,'client_request_id':str(uuid4())})).status_code == 409
    summary = (await client.get('/participation/points',headers=headers('patient1'))).json()
    assert summary['balance'] == 50 and summary['earned_total'] == 150 and summary['reserved_points'] == 100
    assert not summary['exchange_enabled'] and summary['demo_exchange_enabled']
    path = f"/participation/demo-coupons/{coupon['id']}/cancel"
    assert (await client.post(path,headers=headers('patient3'))).status_code == 404
    results = await asyncio.gather(*[client.post(path,headers=headers('patient1')) for _ in range(3)])
    assert all(r.status_code == 200 and r.json()['status'] == 'cancelled' for r in results)
    assert (await client.get('/participation/points',headers=headers('patient1'))).json()['balance'] == 150
    # Retrying the original issue cannot resurrect a cancelled reservation.
    assert (await client.post('/participation/demo-coupons',headers=headers('patient1'),json=data)).json()['status'] == 'cancelled'
    async with database() as session:
        assert await session.scalar(select(func.count(DemoCoupon.id))) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'loyalty.demo_coupon_issued')) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'loyalty.demo_coupon_cancelled')) == 1


async def test_exchange_requires_current_offer_and_has_no_admin_patient_bypass(client, headers, database):
    await fund(database)
    data = {'offer_id':'visit_5','catalog_version':'stale','client_request_id':str(uuid4())}
    assert (await client.post('/participation/demo-coupons',headers=headers('patient1'),json=data)).status_code == 409
    for role in ('doctor','admin'):
        assert (await client.post('/participation/demo-coupons',headers=headers(role),json={**data,'catalog_version':CATALOG_VERSION})).status_code == 403
    assert (await client.post('/participation/demo-coupons',headers=headers('patient3'),json={**data,'catalog_version':CATALOG_VERSION})).status_code == 409


async def test_exchange_audit_failure_rolls_back_reservation(client, headers, database, monkeypatch):
    import app.modules.adherence.rewards as rewards
    await fund(database)
    def fail(*a,**kw): raise RuntimeError('audit failure')
    monkeypatch.setattr(rewards,'record_event',fail)
    with pytest.raises(RuntimeError,match='audit failure'):
        await client.post('/participation/demo-coupons',headers=headers('patient1'),json={'offer_id':'visit_5','catalog_version':CATALOG_VERSION,'client_request_id':str(uuid4())})
    assert (await client.get('/participation/points',headers=headers('patient1'))).json()['balance'] == 150


async def test_doctor_recommends_and_patient_can_select_calm_without_losing_awards(client, headers, database):
    await fund(database,25)
    path = '/patients/1/motivation'
    assert (await client.put(path,headers=headers('doctor2'),json={'mode':'rhythm'})).status_code == 404
    assert (await client.put(path,headers=headers('admin'),json={'mode':'rhythm'})).status_code == 403
    recommendation = (await client.put(path,headers=headers('doctor'),json={'mode':'rhythm'})).json()
    assert recommendation['effective_mode'] == 'rhythm'
    choice = (await client.put('/participation/preferences',headers=headers('patient1'),json={'mode':'calm'})).json()
    assert choice['doctor_recommendation'] == 'rhythm' and choice['effective_mode'] == 'calm'
    summary = (await client.get('/participation/points',headers=headers('patient1'))).json()
    assert summary['earned_total'] == summary['balance'] == 25 and len(summary['activity']) == 7
    assert (await client.put('/participation/preferences',headers=headers('patient1'),json={'mode':None})).json()['effective_mode'] == 'rhythm'
