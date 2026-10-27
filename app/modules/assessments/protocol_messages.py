"""Persist sourced message-review episodes in the message transaction."""
import re

from sqlalchemy import select

from app.modules.access.models import User, UserRole
from app.modules.assessments.alert_protocol import ACUTE, EARLY, MILD, ELLIPTIC_INTENT, SELF_HARM_TOPIC, RULE_VERSION, SOURCE_SHA256, message_signal
from app.modules.assessments.clinical_models import ScenarioEpisode
from app.modules.assessments.models import OutboxEvent
from app.modules.adherence.medications import inventory
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.messaging.models import Message

AVIANDR = re.compile(r"\bавиандр[а-яё]*\b", re.I)


async def capture_protocol_message(session, message) -> bool:
    if message.sender_role != "patient":
        return False
    previous = None
    if ELLIPTIC_INTENT.fullmatch(message.text.strip()):
        previous = await session.scalar(select(Message).where(Message.patient_id == message.patient_id,
            Message.id < message.id).order_by(Message.id.desc()).limit(1))
        if previous is not None and not SELF_HARM_TOPIC.search(previous.text):
            previous = None
    signal = message_signal(message.text, immediate_intent_context=previous is not None)
    needs_context = bool(ACUTE.search(message.text) or (MILD.search(message.text) and EARLY.search(message.text)))
    if signal is None and not needs_context:
        return False
    patient = await session.get(Patient, message.patient_id)
    sender = await session.get(User, message.sender_id) if message.sender_id else None
    if (patient is None or sender is None or sender.id != patient.user_id
            or sender.role != UserRole.patient or not sender.is_active):
        raise ValueError("InvalidProtocolMessageAuthor")
    if signal is None:
        has_aviandr = bool(AVIANDR.search(message.text))
        if not has_aviandr:
            items, _ = await inventory(session, patient)
            has_aviandr = any(AVIANDR.search(item["label"]) for item in items if item["active"])
        signal = message_signal(message.text, aviandr_context=has_aviandr)
    if signal is None:
        return False
    message.emergency_help = signal["priority"] == "CRITICAL"
    if await session.scalar(select(ScenarioEpisode.id).where(ScenarioEpisode.message_id == message.id)):
        return True
    snapshot = {"source_case_id": "Чат", "case_key": RULE_VERSION, "title": signal["title"], "day": 0,
        "facts": [f"Сообщение пациента: {message.text}", "Сообщение требует оценки; диагноз системой не установлен."],
        "message_id": message.id, "hypothesis": signal, "source_file": "Алерты.txt",
        "source_sha256": SOURCE_SHA256, "synthetic": True}
    if previous is not None:
        snapshot["context_message_id"] = previous.id
        snapshot["facts"].append(f"Контекст предыдущего сообщения #{previous.id}: {previous.text}")
    episode = ScenarioEpisode(patient_id=patient.id, message_id=message.id, case_key=RULE_VERSION,
        step_key=f"message_{message.id}", snapshot=snapshot, occurred_at=message.created_at)
    session.add(episode)
    await session.flush()
    session.add(OutboxEvent(event_type="clinical.scenario_review_requested",
        payload={"patient_id": patient.id, "scenario_episode_id": episode.id}))
    record_event(session, sender.id, patient.id, "clinical.message_signal_recorded", "clinical_scenario_episode", episode.id,
        {"message_id": message.id, "rule_version": RULE_VERSION, "priority": signal["priority"], "diagnosis_established": False})
    return True
