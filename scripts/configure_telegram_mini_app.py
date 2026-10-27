"""Preview the bot's public identity and menu; change its global menu only with --apply.

Never writes a webhook, sends messages, or prints bot credentials. Run with the
same environment as the backend; --url must be the final public HTTPS /tg URL.
"""
import argparse
import asyncio
import json
from urllib.parse import urlsplit

import httpx

from app.core.config import get_settings


def mini_app_url(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {'/tg', '/tg/'} or parsed.query or parsed.fragment
            or parsed.hostname in {'localhost', '127.0.0.1', '::1'}):
        raise argparse.ArgumentTypeError('Use a public HTTPS URL ending in /tg without credentials, query or fragment')
    return value


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', type=mini_app_url, required=True)
    parser.add_argument('--expected-bot', default='LimbusMed_bot')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    token = get_settings().telegram_bot_token
    if not token:
        raise RuntimeError('Bot credential is not configured')
    async with httpx.AsyncClient(timeout=15) as client:
        async def call(method: str, payload: dict | None = None):
            response = await client.post(f'https://api.telegram.org/bot{token}/{method}', data=payload or {})
            if response.status_code != 200:
                raise RuntimeError('Telegram API request did not succeed; no response body or credential logged')
            result = response.json()
            if result.get('ok') is not True:
                raise RuntimeError('Telegram API did not confirm the operation')
            return result['result']
        bot = await call('getMe')
        if bot.get('username', '').lower() != args.expected_bot.lstrip('@').lower():
            raise RuntimeError('Bot identity differs from --expected-bot; no configuration changed')
        desired = {'type': 'web_app', 'text': 'Открыть Лимбус', 'web_app': {'url': args.url}}
        before = await call('getChatMenuButton')
        report = {'bot': bot['username'], 'requested_url': args.url, 'current_menu_type': before['type'],
                  'already_matches': before == desired, 'applied': False, 'webhook_changed': False, 'messages_sent': 0}
        if args.apply:
            # Check the real HTTPS document before making a persistent bot configuration change.
            page = await client.get(args.url, follow_redirects=False)
            if page.status_code != 200 or 'text/html' not in page.headers.get('content-type', ''):
                raise RuntimeError('Mini App HTTPS document is unavailable; bot configuration unchanged')
            if await call('setChatMenuButton', {'menu_button': json.dumps(desired, ensure_ascii=False)}) is not True:
                raise RuntimeError('Telegram did not confirm the menu update')
            if await call('getChatMenuButton') != desired:
                raise RuntimeError('Menu update read-back differs; inspect the bot configuration')
            report.update(applied=True, verified_menu=True)
        print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # httpx errors may contain the request URL with the bot token.
        print(f'Bot setup stopped: {type(error).__name__}; credentials and response contents suppressed')
        raise SystemExit(1)
