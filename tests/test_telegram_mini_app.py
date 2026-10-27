"""The Mini App now uses ordinary password authentication without persistent Telegram links."""
import pytest
from datetime import datetime, timezone
from sqlalchemy import func, select

from app.core.security import create_access_token, decode_token
from app.modules.access.models import TelegramBinding, User
from app.modules.audit.models import AuditEvent


@pytest.mark.parametrize('route',['session','link','rebind','unlink'])
async def test_retired_routes_cannot_login_or_create_persistent_bindings(client,database,route):
    sensitive='fictional-sensitive-launch-or-password'
    response=await client.post('/auth/telegram/'+route,json={'username':'patient1','password':sensitive,'init_data':sensitive})
    assert response.status_code==410 and sensitive not in response.text
    async with database() as session:
        assert await session.scalar(select(func.count()).select_from(TelegramBinding))==0


@pytest.mark.parametrize('name',['doctor','doctor2','patient1','patient2','admin'])
async def test_password_login_works_without_telegram_identity_and_preserves_role(client,database,accounts,name):
    response=await client.post('/auth/login',json={'username':name,'password':'test-pass-123'})
    assert response.status_code==200
    token=response.json()['access_token']; payload=decode_token(token)
    assert 'tg_binding_id' not in payload and 'auth_provider' not in payload
    me=await client.get('/auth/me',headers={'Authorization':'Bearer '+token})
    assert me.status_code==200 and me.json()['role']==accounts[name].role.value
    async with database() as session:
        assert await session.scalar(select(func.count()).select_from(TelegramBinding))==0


async def test_old_binding_and_its_token_do_not_restore_automatic_access(client,database,accounts,headers):
    async with database() as session:
        binding=TelegramBinding(user_id=accounts['patient1'].id,telegram_user_id=90001,telegram_chat_id=None,verified_at=datetime.now(timezone.utc))
        session.add(binding);await session.flush();binding_id=binding.id;await session.commit()
    old=create_access_token(accounts['patient1'].id,'patient',telegram_binding_id=binding_id)
    assert (await client.get('/auth/me',headers={'Authorization':'Bearer '+old})).status_code==401
    assert (await client.get('/auth/me',headers=headers('patient1'))).status_code==200
    assert (await client.post('/auth/telegram/session',json={'init_data':'untrusted-telegram-data'})).status_code==410


async def test_password_session_still_enforces_patient_relationship_and_admin_scope(client):
    async def login(name):
        result=await client.post('/auth/login',json={'username':name,'password':'test-pass-123'})
        assert result.status_code==200
        return {'Authorization':'Bearer '+result.json()['access_token']}
    patient=await login('patient1');admin=await login('admin')
    assert (await client.get('/patients/2/assessments',headers=patient)).status_code==404
    assert (await client.get('/patients/1/assessments',headers=admin)).status_code==403


async def test_password_auth_blocks_inactive_accounts_and_never_writes_secrets_to_audit(client,database,accounts):
    result=await client.post('/auth/login',json={'username':'patient1','password':'test-pass-123'})
    assert result.status_code==200
    async with database() as session:
        events=(await session.scalars(select(AuditEvent))).all()
        assert 'test-pass-123' not in str([event.__dict__ for event in events])
        user=await session.get(User,accounts['patient1'].id);user.is_active=False;await session.commit()
    token=result.json()['access_token']
    assert (await client.get('/auth/me',headers={'Authorization':'Bearer '+token})).status_code==401
    assert (await client.post('/auth/login',json={'username':'patient1','password':'test-pass-123'})).status_code==401


async def test_telegram_embedding_and_sdk_are_limited_to_mini_app_document(client):
    mini_app=await client.get('/tg');policy=mini_app.headers['content-security-policy']
    assert 'https://telegram.org' in policy and 'frame-ancestors https://web.telegram.org' in policy
    assert 'x-frame-options' not in mini_app.headers and mini_app.headers['cache-control']=='no-store'
    ordinary=await client.get('/auth/me')
    assert ordinary.headers['x-frame-options']=='DENY' and 'https://telegram.org' not in ordinary.headers['content-security-policy']
