"""Check the deploy helper against the Bot API's serialized menu contract."""
import json
import sys
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest

from scripts import configure_telegram_mini_app as setup


URL = 'https://demo.example.org/tg'
MENU = {'type': 'web_app', 'text': 'Открыть Лимбус', 'web_app': {'url': URL}}


@pytest.fixture
def bot_api(monkeypatch):
    state = {'menu': {'type': 'commands'}, 'calls': [], 'page_status': 200, 'accept_write': True}

    def handle(request):
        if request.url.host == 'demo.example.org':
            state['calls'].append('page')
            return httpx.Response(state['page_status'], text='<html></html>',
                                  headers={'content-type': 'text/html'})
        method = request.url.path.rsplit('/', 1)[-1]
        state['calls'].append(method)
        if method == 'getMe':
            result = {'username': 'LimbusMed_bot', 'is_bot': True}
        elif method == 'getChatMenuButton':
            result = state['menu']
        elif method == 'setChatMenuButton':
            form = parse_qs(request.content.decode())
            menu = json.loads(form['menu_button'][0])
            if state['accept_write']:
                state['menu'] = menu
            result = True
        else:
            pytest.fail(f'Unexpected bot operation: {method}')
        return httpx.Response(200, json={'ok': True, 'result': result})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(setup.httpx, 'AsyncClient',
                        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(setup, 'get_settings', lambda: SimpleNamespace(telegram_bot_token='test-credential'))
    monkeypatch.setattr(sys, 'argv', ['configure_telegram_mini_app', '--url', URL])
    return state


@pytest.mark.asyncio
async def test_preview_never_changes_menu(bot_api, capsys):
    await setup.main()
    report = json.loads(capsys.readouterr().out)
    assert report['applied'] is False
    assert bot_api['calls'] == ['getMe', 'getChatMenuButton']
    assert bot_api['menu'] == {'type': 'commands'}


@pytest.mark.asyncio
async def test_apply_sets_and_reads_back_serialized_menu(bot_api, capsys, monkeypatch):
    monkeypatch.setattr(sys, 'argv', sys.argv + ['--apply'])
    await setup.main()
    report = json.loads(capsys.readouterr().out)
    assert report['verified_menu'] is True
    assert bot_api['menu'] == MENU
    assert bot_api['calls'] == ['getMe', 'getChatMenuButton', 'page',
                                'setChatMenuButton', 'getChatMenuButton']
    assert 'test-credential' not in json.dumps(report)


@pytest.mark.asyncio
async def test_unavailable_document_prevents_bot_write(bot_api, capsys, monkeypatch):
    bot_api['page_status'] = 503
    monkeypatch.setattr(sys, 'argv', sys.argv + ['--apply'])
    with pytest.raises(RuntimeError, match='document is unavailable'):
        await setup.main()
    assert 'setChatMenuButton' not in bot_api['calls']
    assert capsys.readouterr().out == ''


@pytest.mark.asyncio
async def test_api_true_without_matching_readback_is_not_success(bot_api, capsys, monkeypatch):
    bot_api['accept_write'] = False
    monkeypatch.setattr(sys, 'argv', sys.argv + ['--apply'])
    with pytest.raises(RuntimeError, match='read-back differs'):
        await setup.main()
    assert capsys.readouterr().out == ''
