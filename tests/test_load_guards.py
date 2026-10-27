from types import SimpleNamespace
import json

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from scripts.load_scenario import export_k6_users


def isolated(**changes):
    return Settings(_env_file=None,compass_database_url=changes.pop('compass_database_url','postgresql://x@localhost/compass_load_test'),
        mis_database_url=changes.pop('mis_database_url','postgresql://x@localhost/mis_load_test'),
        jwt_secret='load-test-secret',redis_url='redis://localhost:6379/0',load_test_mode=True,
        load_test_run_id='fixture-marker-123456789',**changes)


@pytest.mark.parametrize('values',[{'compass_database_url':'postgresql://x@localhost/compass'},
    {'mis_database_url':'postgresql://x@localhost/mis'},{'telegram_enabled':True},{'telegram_mini_app_enabled':True}])
def test_load_mode_refuses_real_database_or_external_delivery(values):
    with pytest.raises(ValidationError): isolated(**values)


async def test_temporary_token_export_refuses_normal_app_before_connecting(tmp_path):
    manifest=tmp_path/'manifest.json';manifest.write_text(json.dumps({'run_id':'some-fixture'}))
    with pytest.raises(ValueError,match='LOAD_TEST_MODE'):
        await export_k6_users(SimpleNamespace(manifest=manifest,output=tmp_path/'tokens.json'))
    assert not (tmp_path/'tokens.json').exists()


async def test_load_context_hidden_on_ordinary_app(client):
    assert (await client.get('/_load-test/context')).status_code==404
