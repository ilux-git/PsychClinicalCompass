"""A bounded mention rule for the supplied P009 case; no inferred diagnosis or intake."""
from datetime import datetime
import re

from sqlalchemy import select

from app.modules.access.models import User, UserRole
from app.modules.assessments.clinical_models import ScenarioEpisode
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.scenarios import scenario_for_mis, step_hypothesis
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient


PAROXETINE = re.compile(r"\b(?:пароксетин[а-яё]*|paroxetine)\b", re.IGNORECASE)


async def review_patient_message(session, message):
    if message.sender_role != "patient":
        return
    from app.modules.assessments.protocol_messages import capture_protocol_message
    if await capture_protocol_message(session, message):
        return
    if not PAROXETINE.search(message.text):
        return
    patient = await session.get(Patient, message.patient_id)
    sender = await session.get(User, message.sender_id) if message.sender_id else None
    if (patient is None or sender is None or sender.id != patient.user_id
            or sender.role != UserRole.patient or not sender.is_active):
        raise ValueError("InvalidScenarioMessageAuthor")
    case = scenario_for_mis(patient.mis_id)
    if case is None or case["source_id"] != "P009":
        return
    if await session.scalar(select(ScenarioEpisode.id).where(ScenarioEpisode.message_id == message.id)):
        return
    step = next(step for step in case["steps"] if step["key"] == "self_medication")
    hypothesis = step_hypothesis(case, step)
    hypothesis.update(
        severity="review_required",
        proposal="В сообщении пациента упомянут пароксетин. На фоне записанного врачом плана с Авиандром возможно взаимодействие: ОХЛП рекомендует осторожность с СИОЗС и ингибиторами CYP2D6. Уточните фактический приём, дозу, время и жалобы. Само упоминание, в том числе отрицание приёма, не подтверждает приём, нежелательное явление или интоксикацию. Вывод делает врач.",
        source="patient_message_with_manufacturer_smPC",
    )
    anchor = datetime.fromisoformat(case["anchor_date"].replace("Z", "+00:00"))
    snapshot = {
        "source_case_id":case["source_id"], "case_key":case["key"],
        "title":"Упоминание пароксетина в сообщении пациента",
        "day":max(0, (message.created_at.date()-anchor.date()).days),
        "facts":[f"Сообщение пациента: {message.text}", "Факт приёма и наличие нежелательного явления требуют уточнения врачом."],
        "message_id":message.id, "hypothesis":hypothesis, "source_file":None,
        "source_sha256":None, "synthetic":True,
    }
    episode = ScenarioEpisode(patient_id=patient.id, message_id=message.id, case_key=case["key"],
        step_key=f"message_{message.id}", snapshot=snapshot, occurred_at=message.created_at)
    session.add(episode)
    await session.flush()
    session.add(OutboxEvent(event_type="clinical.scenario_review_requested",
        payload={"patient_id":patient.id, "scenario_episode_id":episode.id}))
    record_event(session, sender.id, patient.id, "scenario.message_review_requested", "clinical_scenario_episode",
        episode.id, {"message_id":message.id, "rule_version":hypothesis["rule_version"], "diagnosis_established":False})
