from fastapi import APIRouter, Depends, Header, HTTPException, Request, Query, status
from secrets import compare_digest

from app.api.deps import CompassSession, CurrentUser
from app.core.config import get_settings
from app.modules.access.models import User, UserRole
from app.modules.messaging.models import Message
from app.modules.messaging.schemas import MessageCreate, MessageRead
from app.modules.messaging.service import MessagingError, get_history, receive_telegram_message, send_message

router = APIRouter(tags=["messaging"])


@router.get("/conversations/{patient_id}/messages", response_model=list[MessageRead])
async def list_messages(
    patient_id: int,
    session: CompassSession,
    user: CurrentUser,
    after_id: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[Message]:
    try:
        return await get_history(session, user, patient_id, limit, after_id)
    except MessagingError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.post("/conversations/{patient_id}/messages", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def post_message(
    patient_id: int,
    payload: MessageCreate,
    session: CompassSession,
    user: CurrentUser,
) -> Message:
    if user.role not in (UserRole.doctor, UserRole.patient):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
    try:
        message = await send_message(session, patient_id, user, payload.text, payload.channel,
                                     str(payload.client_request_id) if payload.client_request_id else None)
        await session.commit()
    except MessagingError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    return message


@router.post("/integrations/telegram/webhook", status_code=status.HTTP_200_OK)
async def telegram_webhook(
    request: Request,
    session: CompassSession,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, str]:
    settings = get_settings()
    # A shared webhook secret does not establish the patient's identity.
    # Live Telegram remains disabled until channel binding is configured.
    if not settings.telegram_enabled:
        raise HTTPException(503, "Живой Telegram не подключён. Используйте авторизованный симулятор")
    if not settings.telegram_webhook_secret or not compare_digest((x_telegram_bot_api_secret_token or "").encode(), settings.telegram_webhook_secret.encode()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid webhook secret")
    try:
        update = await request.json()
    except ValueError:
        return {"status": "ignored"}
    if not isinstance(update, dict) or not isinstance(update.get("message"), dict):
        return {"status": "ignored"}
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    sender = message.get("from") or {}
    if not isinstance(chat, dict) or not isinstance(sender, dict):
        return {"status": "ignored"}
    chat_id = chat.get("id")
    sender_id = sender.get("id")
    text = message.get("text")
    if chat.get("type") != "private" or type(chat_id) is not int or type(sender_id) is not int or not isinstance(text, str) or not text.strip() or len(text) > 4096:
        return {"status": "ignored"}
    message_id = message.get("message_id")
    if type(message_id) is not int:
        return {"status": "ignored"}
    external_id = f"tg:{chat_id}:{message_id}"
    await receive_telegram_message(session, chat_id, external_id, text, sender_id)
    await session.commit()
    return {"status": "ok"}
