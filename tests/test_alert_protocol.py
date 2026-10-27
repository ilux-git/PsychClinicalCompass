from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.assessments.alert_protocol import RULE_VERSION, assess_current_review, message_signal
from app.modules.assessments.catalog import GAD7_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalResult, ScenarioEpisode
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.triage import assess_review
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.alerts.escalation import route_due_urgent_alerts
from app.modules.messaging.models import Message
from app.workers.outbox_worker import process_pending_events
from tests.test_clinical_review import complete, numeric_answers
from tests.test_clinical_instruments import values
from tests.test_coordinator_fallback import coordinators, configure


@pytest.mark.parametrize("text,context,priority", [
    ("Я сейчас убью себя.", False, "CRITICAL"),
    ("Я уже стою на подоконнике", False, "CRITICAL"),
    ("Я сейчас причиню вред ребенку", False, "CRITICAL"),
    ("У меня спутанность сознания", True, "CRITICAL"),
    ("Я упала в обморок", True, "CRITICAL"),
    ("Я не могу стоять", True, "CRITICAL"),
    ("У меня отекло лицо", False, "HIGH"),
    ("Меня сильно тошнит", True, "HIGH"),
    ("Я сам добавил пароксетин", True, "HIGH"),
    ("С начала приема немного кружится голова", True, "MEDIUM"),
])
def test_protocol_messages_explain_priority_without_establishing_diagnosis(text, context, priority):
    signal = message_signal(text, aviandr_context=context)
    assert signal["priority"] == priority and signal["rule_version"] == RULE_VERSION
    assert not signal["diagnosis_established"] and not signal["immediate_danger_established"] and not signal["therapy_changed"]
    assert signal["acknowledgement_minutes"] == (5 if priority == "CRITICAL" else None)


@pytest.mark.parametrize("text", [
    "Я не собираюсь убивать себя", "Я сейчас это сделаю", "Я сейчас приму назначенную таблетку",
    'В инструкции приведён пример: «Я сейчас убью себя».',
    'Пациент произнёс: "Я сейчас убью себя".',
    "Я сам купил удобный стул", "Я не могу стоять", "С начала приема ничего не беспокоит",
])
def test_neutral_negated_quoted_or_contextless_text_is_not_a_critical_diagnosis(text):
    assert message_signal(text) is None


@pytest.mark.parametrize("key,score,prior", [(PHQ9_KEY, 15, None), (PHQ9_KEY, 16, None),
    (PHQ9_KEY, 14, 4), (PHQ9_KEY, 14, 5), (PHQ9_KEY, 16, 6), (GAD7_KEY, 9, None), (GAD7_KEY, 10, None), (GAD7_KEY, 15, None)])
def test_new_protocol_preserves_approved_score_boundaries_and_replaces_old_action_hours(key, score, prior):
    reference = {"result_id": 1, "score": prior, "created_at": "2026-10-20T10:00:00Z"} if prior is not None else None
    legacy = assess_review(key, score, {}, previous=reference)
    current = assess_current_review(key, score, {}, previous=reference)
    assert current["grounds"] == legacy["grounds"] and current["severity"] == legacy["severity"]
    assert current["comparison_previous"] == legacy["comparison_previous"]
    assert current["action_due_hours"] is None and current["acknowledgement_minutes"] is None
    assert current["rule_version"] == RULE_VERSION and not current["immediate_danger_established"]


def test_item9_is_high_but_never_critical_or_proven_immediate_danger():
    current = assess_current_review(PHQ9_KEY, 1, {"item9_positive": True})
    assert current["priority"] == "HIGH" and current["severity"] == "urgent_review"
    assert current["action_due_hours"] is None and not current["immediate_danger_established"]
    assert "12–24" not in " ".join(current["advisory"])


async def test_elliptical_intent_uses_only_its_own_preceding_conversation_context(client, headers):
    await post_signal(client, headers, text="Вы планируете причинить себе вред прямо сейчас?", who="doctor")
    await post_signal(client, headers, text="Я сейчас это сделаю")
    assert await process_pending_events() == 1
    alert = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    assert alert["severity"] == "critical_review"
    assert alert["decision"]["facts"]["case_review"]["context_message_id"] is not None


async def post_signal(client, headers, text="Я сейчас убью себя", who="patient1"):
    payload = {"text": text, "channel": "web", "client_request_id": str(uuid4())}
    response = await client.post("/conversations/1/messages", headers=headers(who), json=payload)
    assert response.status_code == 201, response.text
    return payload, response.json()


async def test_message_signal_is_atomic_idempotent_scoped_and_requires_physician_action(client, headers, database):
    payload, message = await post_signal(client, headers)
    assert not message["support_requested"] and message["emergency_help"]
    retry = await client.post("/conversations/1/messages", headers=headers("patient1"), json=payload)
    assert retry.json()["id"] == message["id"] and retry.json()["emergency_help"]
    assert await process_pending_events() == 1 and await process_pending_events() == 0
    history = (await client.get("/conversations/1/messages", headers=headers("patient1"))).json()
    assert history[-1]["emergency_help"] is True
    rows = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()
    assert len(rows) == 1
    alert = rows[0]
    assert alert["severity"] == "critical_review" and alert["rule_version"] == RULE_VERSION
    assert datetime.fromisoformat(alert["review_timing"]["acknowledgement_due_at"]) - datetime.fromisoformat(message["created_at"]) == timedelta(minutes=5)
    assert alert["review_timing"]["immediate_action_required"]
    assert alert["decision"]["facts"]["case_review"]["message_id"] == message["id"]
    for role in ("patient1", "admin", "doctor2"):
        assert (await client.post(f"/alerts/{alert['id']}/acknowledge", headers=headers(role))).status_code in {403, 404}
    await client.post(f"/alerts/{alert['id']}/acknowledge", headers=headers("doctor"))
    assert (await client.post(f"/alerts/{alert['id']}/close", headers=headers("doctor"))).status_code == 409
    async with database() as session:
        assert await session.scalar(select(func.count(Message.id))) == 1
        assert await session.scalar(select(func.count(ScenarioEpisode.id))) == 1
        assert await session.scalar(select(func.count(Alert.id))) == 1
        decision = await session.scalar(select(ClinicalDecision))
        assert decision.status == "pending_review" and decision.confirmed_at is None


async def test_failed_protocol_audit_rolls_back_message_episode_and_outbox(client, headers, database, monkeypatch):
    import app.modules.assessments.protocol_messages as protocol
    def fail(*args, **kwargs):
        raise RuntimeError("InjectedProtocolAuditFailure")
    monkeypatch.setattr(protocol, "record_event", fail)
    with pytest.raises(RuntimeError, match="InjectedProtocolAuditFailure"):
        await post_signal(client, headers)
    async with database() as session:
        for model in (Message, ScenarioEpisode, OutboxEvent):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_doctor_quotes_do_not_generate_patient_danger_events(client, headers, database):
    await post_signal(client, headers, who="doctor")
    assert await process_pending_events() == 0
    async with database() as session:
        assert await session.scalar(select(func.count(ScenarioEpisode.id))) == 0


async def test_critical_alert_routes_once_after_five_minutes_with_only_patient_id(client, headers, coordinators, database):
    await configure(client, headers, coordinators)
    await client.patch("/doctors/me/availability", headers=headers("doctor"), json={"availability": "available"})
    await post_signal(client, headers)
    await process_pending_events()
    async with database() as session:
        alert = await session.scalar(select(Alert))
        assert await route_due_urgent_alerts(session, now=alert.acknowledgement_due_at - timedelta(seconds=1)) == 0
        assert await route_due_urgent_alerts(session, now=alert.acknowledgement_due_at + timedelta(seconds=1)) == 1
        assert await route_due_urgent_alerts(session, now=alert.acknowledgement_due_at + timedelta(minutes=1)) == 0
        await session.commit()
    notice = (await client.get("/coordination/urgent-notices", headers=headers("coordinator"))).json()["items"][0]
    assert notice["patient_id"] == 1 and "patient_name" not in notice and "text" not in notice and "facts" not in notice
    assert (await client.get("/patients/1", headers=headers("coordinator"))).status_code == 403


async def test_priority_pagination_does_not_skip_newer_medium_alerts(client, headers, database):
    await post_signal(client, headers)
    await process_pending_events()
    await complete(client, headers, PHQ9_KEY, numeric_answers(16))
    await complete(client, headers, GAD7_KEY, values(7, 3))
    await process_pending_events()
    items, cursor = [], None
    for _ in range(4):
        page = (await client.get("/alerts/inbox?limit=1" + (f"&before_id={cursor}" if cursor else ""), headers=headers("doctor"))).json()
        items.extend(page["items"])
        cursor = page["next_before_id"]
        if cursor is None:
            break
    assert [item["severity"] for item in items] == ["critical_review", "urgent_review", "review_required"]
    assert len({item["id"] for item in items}) == 3
    urgent = (await client.get("/alerts/inbox?priority=urgent", headers=headers("doctor"))).json()
    assert urgent["urgent_open"] == 2 and len(urgent["items"]) == 2


async def test_previously_recorded_rule_version_still_processes_its_original_deadlines(client, headers, database):
    await complete(client, headers, PHQ9_KEY, numeric_answers(0))
    await complete(client, headers, PHQ9_KEY, numeric_answers(16))
    async with database() as session:
        row = await session.scalar(select(ClinicalResult).order_by(ClinicalResult.id.desc()))
        row.result = {**row.result, "triage": assess_review(PHQ9_KEY, 16, row.result,
            previous={"result_id": 1, "score": 0, "created_at": "2026-10-20T10:00:00Z"})}
        await session.commit()
    assert await process_pending_events() == 1
    row = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    assert row["rule_version"] == "medical_answers_20261026_v1"
    assert datetime.fromisoformat(row["review_timing"]["acknowledgement_due_at"]) - datetime.fromisoformat(row["created_at"]) == timedelta(hours=2)
    assert row["review_timing"]["action_due_at"] is not None
