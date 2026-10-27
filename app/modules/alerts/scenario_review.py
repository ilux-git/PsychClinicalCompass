from datetime import datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert

from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.assessments.clinical_models import ScenarioEpisode
from app.modules.assessments.scenarios import RULE_VERSION
from app.modules.assessments.alert_protocol import RULE_VERSION as PROTOCOL_VERSION, SOURCE_SHA256
from app.modules.audit.service import record_event
from app.modules.messaging.models import Message
from app.modules.patients.models import Patient


async def create_scenario_alert(session, event):
    reference=event.payload.get("scenario_episode_id")
    if type(reference) is not int:
        raise ValueError("MissingScenarioEpisodeReference")
    episode=await session.get(ScenarioEpisode, reference)
    if episode is None or episode.patient_id!=event.payload.get("patient_id"):
        raise ValueError("InvalidScenarioEpisodeReference")
    context=episode.snapshot
    if episode.message_id is not None:
        message=await session.get(Message,episode.message_id)
        patient=await session.get(Patient,episode.patient_id)
        if (message is None or patient is None or message.patient_id!=episode.patient_id
                or message.sender_role!="patient" or message.sender_id!=patient.user_id
                or context.get("message_id")!=message.id):
            raise ValueError("InvalidScenarioMessageReference")
    hypothesis=context.get("hypothesis")
    is_protocol = bool(hypothesis and hypothesis.get("rule_version") == PROTOCOL_VERSION)
    if not hypothesis or hypothesis.get("rule_version") not in {RULE_VERSION, PROTOCOL_VERSION} or hypothesis.get("severity") not in {"review_required","urgent_review","critical_review"}:
        raise ValueError("UnapprovedScenarioReview")
    if is_protocol and (episode.message_id is None or context.get("source_sha256") != SOURCE_SHA256):
        raise ValueError("InvalidProtocolSource")
    if not is_protocol and hypothesis["severity"] == "critical_review":
        raise ValueError("UnapprovedCriticalScenario")
    now=datetime.now(timezone.utc)
    acknowledgement_due = episode.occurred_at + timedelta(minutes=5) if hypothesis["severity"] == "critical_review" else (
        now + timedelta(hours=2) if not is_protocol and hypothesis["severity"] == "urgent_review" else None)
    alert=(await session.execute(insert(Alert).values(patient_id=episode.patient_id,source_event_id=event.id,
        scenario_episode_id=episode.id,source_kind="clinical_scenario",rule_id="patient_message_review" if is_protocol else "aviandr_case_review",rule_version=hypothesis["rule_version"],
        severity=hypothesis["severity"],status="created",created_at=now,
        acknowledgement_due_at=acknowledgement_due,
        reason=f'{context["source_case_id"]}: {context["title"]}. Требуется оценка гипотезы врачом.'
    ).on_conflict_do_nothing(index_elements=[Alert.source_event_id]).returning(Alert))).scalar_one_or_none()
    if alert is None:return
    source = hypothesis.get("review_source") or hypothesis["drug_source"]
    session.add(ClinicalDecision(patient_id=episode.patient_id,alert_id=alert.id,status="pending_review",version=1,
        facts={"form_type":"message_review" if is_protocol else "aviandr_review","score":None,"risk_flags":[],"source":"clinical_scenario",
            "scenario_episode_id":episode.id,"system_proposal":hypothesis["proposal"],"case_review":context,
            "source_title":source["title"],"source_url":source["url"]},
        missing_data=[*(["Актуальность редакции ГРЛС требует сверки"] if not is_protocol else []),*hypothesis["missing_data"]]))
    record_event(session,None,episode.patient_id,"alert.created","alert",alert.id,
        {"source_kind":"clinical_scenario","scenario_episode_id":episode.id,"rule_version":hypothesis["rule_version"]})
