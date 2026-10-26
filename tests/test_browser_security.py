import pytest
from pydantic import ValidationError

from app.core.browser_security import BrowserSecurityMiddleware
from app.core.config import Settings


@pytest.mark.parametrize('path', ['/', '/auth/me', '/patients/1/clinical-results', '/no-such-page'])
async def test_html_and_denied_requests_keep_browser_safeguards(client, path):
    response = await client.get(path)
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.headers['Referrer-Policy'] == 'no-referrer'
    assert response.headers['X-Frame-Options'] == 'DENY'
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    policy = response.headers['Content-Security-Policy']
    assert "script-src 'self'" in policy and "connect-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
    assert 'unsafe-eval' not in policy
    assert response.headers['Permissions-Policy'] == 'camera=(), microphone=(), geolocation=()'


async def test_security_wrapper_preserves_api_body_and_does_not_treat_assets_as_clinical_html():
    received = []

    async def application(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200, 'headers': [(b'content-type', b'text/javascript')]})
        await send({'type': 'http.response.body', 'body': b'export const synthetic = true;'})

    async def send(message):
        received.append(message)

    await BrowserSecurityMiddleware(application)({'type': 'http', 'path': '/assets/example-hash1234.js'}, None, send)
    assert received[1]['body'] == b'export const synthetic = true;'
    assert b'cache-control' not in dict(received[0]['headers'])
    assert b'content-security-policy' in dict(received[0]['headers'])


async def test_api_reference_is_local_and_keeps_a_usable_openapi_schema(client):
    response = await client.get('/docs')
    assert response.status_code == 200
    assert '<a href="/openapi.json">' in response.text
    assert '<script' not in response.text.lower() and 'cdn.' not in response.text.lower()
    schema = (await client.get('/openapi.json')).json()
    assert '/patients/{patient_id}/clinical-results' in schema['paths']


def test_real_data_mode_is_not_an_available_configuration(monkeypatch):
    monkeypatch.setenv('DATA_MODE', 'real_patients')
    with pytest.raises(ValidationError, match='synthetic_demo'):
        Settings()
