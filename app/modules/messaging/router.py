from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

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
) -> list[Message]:
    try:
        return await get_history(session, user, patient_id)
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
        message = await send_message(session, patient_id, user, payload.text, payload.channel)
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
    if not settings.telegram_webhook_secret or x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid webhook secret")
    update = await request.json()
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    text = message.get("text")
    if not isinstance(chat_id, int) or not isinstance(text, str) or not text:
        return {"status": "ignored"}
    message_id = message.get("message_id")
    external_id = f"tg:{chat_id}:{message_id}" if isinstance(message_id, int) else f"tg:{chat_id}:unknown"
    await receive_telegram_message(session, chat_id, external_id, text)
    await session.commit()
    return {"status": "ok"}
