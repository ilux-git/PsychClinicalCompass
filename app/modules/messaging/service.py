import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessments.models import OutboxEvent
from app.modules.access.models import User
from app.modules.messaging.models import Message, MessageChannel, MessageStatus
from app.modules.patients.models import Patient

logger = logging.getLogger("app.messaging")


class MessagingError(Exception):
    pass


async def _get_patient(session: AsyncSession, patient_id: int) -> Patient:
    patient = await session.get(Patient, patient_id)
    if patient is None:
        raise MessagingError(f"patient {patient_id} not found")
    return patient


def _validate_channel(user: User, channel: str) -> None:
    allowed_by_role: dict[str, set[str]] = {
        "doctor": {MessageChannel.WEB, MessageChannel.TG_DOCTOR},
        "patient": {MessageChannel.WEB, MessageChannel.TG_PATIENT},
        "admin": {MessageChannel.WEB},
    }
    if channel not in allowed_by_role[user.role.value]:
        raise MessagingError(f"role {user.role.value} cannot send via channel {channel}")


def _initial_status(channel: str) -> str:
    return MessageStatus.QUEUED if channel.startswith("tg_") else MessageStatus.SENT


async def send_message(
    session: AsyncSession,
    patient_id: int,
    sender: User,
    text: str,
    channel: str,
) -> Message:
    patient = await _get_patient(session, patient_id)
    if sender.role == "patient" and patient.user_id != sender.id:
        raise MessagingError("patient can only send to own conversation")
    if sender.role == "doctor" and patient.doctor_id != sender.id:
        raise MessagingError("doctor can only send to own patients")
    _validate_channel(sender, channel)
    message = Message(
        patient_id=patient_id,
        sender_id=sender.id,
        sender_role=sender.role.value,
        text=text,
        status=_initial_status(channel),
        channel=channel,
    )
    session.add(message)
    await session.flush()
    if channel.startswith("tg_"):
        session.add(
            OutboxEvent(
                event_type="telegram.send_message",
                payload={"message_id": message.id, "patient_id": patient_id, "text": text, "channel": channel},
            )
        )
    return message


async def get_history(
    session: AsyncSession,
    viewer: User,
    patient_id: int,
    limit: int = 100,
) -> list[Message]:
    patient = await _get_patient(session, patient_id)
    if viewer.role == "patient" and patient.user_id != viewer.id:
        raise MessagingError("patient can only view own conversation")
    if viewer.role == "doctor" and patient.doctor_id != viewer.id:
        raise MessagingError("doctor can only view own patients")
    result = await session.execute(
        select(Message)
        .where(Message.patient_id == patient_id)
        .order_by(Message.created_at, Message.id)
        .limit(limit)
    )
    return list(result.scalars())


async def receive_telegram_message(
    session: AsyncSession,
    chat_id: int,
    external_message_id: str,
    text: str,
) -> Message | None:
    existing = await session.execute(select(Message).where(Message.external_message_id == external_message_id))
    found = existing.scalar_one_or_none()
    if found is not None:
        logger.info("duplicate telegram message %s ignored", external_message_id)
        return None
    patient_result = await session.execute(select(Patient).where(Patient.mis_id == chat_id))
    patient = patient_result.scalar_one_or_none()
    if patient is None:
        logger.info("telegram chat %s has no linked patient, message ignored", chat_id)
        return None
    message = Message(
        patient_id=patient.id,
        sender_id=None,
        sender_role="patient",
        text=text,
        status=MessageStatus.SENT,
        channel=MessageChannel.TG_PATIENT,
        external_message_id=external_message_id,
    )
    session.add(message)
    await session.flush()
    return message
