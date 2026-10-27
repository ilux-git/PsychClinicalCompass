import logging

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from app.modules.assessments.models import OutboxEvent
from app.modules.access.models import User, UserRole, TelegramBinding
from app.modules.messaging.models import Message, MessageChannel, MessageStatus
from app.modules.patients.models import Patient
from app.api.deps import patient_for_user
from app.modules.audit.service import record_event

logger = logging.getLogger("app.messaging")


class MessagingError(Exception):
    pass


def _validate_channel(user: User, channel: str) -> None:
    allowed_by_role: dict[str, set[str]] = {
        "doctor": {MessageChannel.WEB, MessageChannel.TG_DOCTOR},
        "patient": {MessageChannel.WEB, MessageChannel.TG_PATIENT},
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
    client_request_id: str | None = None,
    support_requested: bool = False,
) -> Message:
    await patient_for_user(session, sender, patient_id)
    _validate_channel(sender, channel)
    if support_requested and sender.role != UserRole.patient:
        raise MessagingError("Запрос поддержки отправляет сам пациент")
    values = dict(
        patient_id=patient_id,
        sender_id=sender.id,
        sender_role=sender.role.value,
        text=text,
        status=_initial_status(channel),
        channel=channel,
        client_request_id=client_request_id,
        support_requested=support_requested,
    )
    message = (await session.execute(insert(Message).values(**values).on_conflict_do_nothing(
        constraint="uq_message_request").returning(Message))).scalar_one_or_none()
    if message is None:
        message = await session.scalar(select(Message).where(Message.sender_id == sender.id, Message.client_request_id == client_request_id))
        if (message.patient_id != patient_id or message.text != text or message.channel != channel
                or message.support_requested != support_requested):
            from fastapi import HTTPException
            raise HTTPException(409, "Ключ запроса уже использован с другим сообщением")
        if sender.role == UserRole.patient:
            message.emergency_help = await _has_open_critical_review(session, patient_id)
        return message
    if channel.startswith("tg_"):
        session.add(
            OutboxEvent(
                event_type="telegram.send_message",
                payload={"message_id": message.id, "patient_id": patient_id},
            )
        )
    if support_requested:
        session.add(OutboxEvent(event_type="patient.support_requested",
                                payload={"message_id": message.id, "patient_id": patient_id}))
    record_event(session, sender.id, patient_id, "message.created", "message", message.id)
    from app.modules.assessments.scenario_messages import review_patient_message
    await review_patient_message(session, message)
    return message


async def get_history(
    session: AsyncSession,
    viewer: User,
    patient_id: int,
    limit: int = 100,
    after_id: int | None = None,
) -> list[Message]:
    if viewer.role.value not in {"doctor", "patient"}:
        raise MessagingError("Нет клинического доступа")
    await patient_for_user(session, viewer, patient_id)
    query = select(Message).where(Message.patient_id == patient_id)
    if after_id is not None:
        query = query.where(Message.id > after_id).order_by(Message.id)
        rows = list((await session.scalars(query.limit(limit))).all())
    else:
        rows = list(reversed(list((await session.scalars(query.order_by(Message.id.desc()).limit(limit))).all())))
    if viewer.role == UserRole.patient and rows:
        rows[-1].emergency_help = await _has_open_critical_review(session, patient_id)
    return rows


async def _has_open_critical_review(session: AsyncSession, patient_id: int) -> bool:
    from app.modules.assessments.clinical_models import ScenarioEpisode
    from app.modules.assessments.alert_protocol import RULE_VERSION
    from app.modules.alerts.models import Alert

    active = await session.scalar(select(ScenarioEpisode.id).outerjoin(Alert,
        Alert.scenario_episode_id == ScenarioEpisode.id).where(
        ScenarioEpisode.patient_id == patient_id, ScenarioEpisode.case_key == RULE_VERSION,
        ScenarioEpisode.snapshot["hypothesis"]["priority"].astext == "CRITICAL",
        or_(Alert.id.is_(None), Alert.status != "closed")).limit(1))
    return active is not None


async def receive_telegram_message(
    session: AsyncSession,
    chat_id: int,
    external_message_id: str,
    text: str,
    sender_telegram_id: int | None = None,
) -> Message | None:
    if sender_telegram_id is None:
        return None
    patient = await session.scalar(select(Patient).join(User, User.id == Patient.user_id).join(
        TelegramBinding, TelegramBinding.user_id == User.id).where(
        TelegramBinding.telegram_chat_id == chat_id, TelegramBinding.telegram_user_id == sender_telegram_id,
        User.role == UserRole.patient, User.is_active.is_(True)))
    if patient is None:
        logger.info("ignored Telegram update without verified binding")
        return None
    values = dict(
        patient_id=patient.id,
        sender_id=patient.user_id,
        sender_role="patient",
        text=text,
        status=MessageStatus.SENT,
        channel=MessageChannel.TG_PATIENT,
        external_message_id=external_message_id,
    )
    message = (await session.execute(insert(Message).values(**values).on_conflict_do_nothing(
        constraint="uq_messages_external_message_id").returning(Message))).scalar_one_or_none()
    if message:
        record_event(session, patient.user_id, patient.id, "message.received", "message", message.id)
        from app.modules.assessments.scenario_messages import review_patient_message
        await review_patient_message(session, message)
    return message
