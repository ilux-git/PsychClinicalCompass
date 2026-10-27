"""Retire automatic Telegram account linking; use ordinary password login."""
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix='/auth/telegram', tags=['telegram-mini-app'])


@router.post('/session')
@router.post('/link')
@router.post('/rebind')
@router.post('/unlink')
async def retired_linking() -> None:
    raise HTTPException(410, 'Привязка Telegram отключена. Обновите приложение и войдите по логину и паролю.')