"""Validate raw Telegram Mini App launch credentials locally, before trusting identity."""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import hmac
import json
import re
from urllib.parse import parse_qsl

from fastapi import HTTPException

from app.core.config import get_settings


@dataclass(frozen=True)
class TelegramIdentity:
    user_id: int


def validate_init_data(raw: str) -> TelegramIdentity:
    settings = get_settings()
    if not settings.telegram_mini_app_enabled or not settings.telegram_bot_token.strip():
        raise HTTPException(503, "Вход через Telegram пока не подключён")
    try:
        if not isinstance(raw, str) or not raw or len(raw) > 16384 or re.search(r'%(?![0-9a-fA-F]{2})', raw):
            raise ValueError
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True, errors='strict', max_num_fields=30)
        values = dict(pairs)
        if len(pairs) != len(values) or not re.fullmatch(r'[0-9a-fA-F]{64}', values.get('hash', '')):
            raise ValueError
        received_hash = values.pop('hash')
        # For bot-token HMAC, all other received fields (including signature) participate.
        check = '\n'.join(f'{key}={values[key]}' for key in sorted(values))
        secret = hmac.new(b'WebAppData', settings.telegram_bot_token.encode(), sha256).digest()
        expected = hmac.new(secret, check.encode(), sha256).hexdigest()
        if not hmac.compare_digest(expected, received_hash.lower()):
            raise ValueError
        auth_date = values.get('auth_date', '')
        if not auth_date.isascii() or not auth_date.isdigit() or len(auth_date) > 12:
            raise ValueError
        age = datetime.now(timezone.utc).timestamp() - int(auth_date)
        if age < -30 or age > settings.telegram_init_data_max_age_seconds:
            raise ValueError
        user = json.loads(values.get('user', 'null'))
        if not isinstance(user, dict) or type(user.get('id')) is not int or not 0 < user['id'] < 2**52 or user.get('is_bot', False) is not False:
            raise ValueError
        return TelegramIdentity(user_id=user['id'])
    except (ValueError, TypeError, UnicodeError):
        # Never echo initData, profile fields, passwords, hashes or bot credentials.
        raise HTTPException(401, "Не удалось подтвердить вход Telegram. Закройте приложение и откройте его заново через бота.") from None
