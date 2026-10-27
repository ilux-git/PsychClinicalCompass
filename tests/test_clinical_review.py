from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalBaseline, ClinicalResult
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.triage import assess_review
from app.workers.outbox_worker import process_pending_events
from tests.test_clinical_instruments import assigned, values


def reference(score, result_id=1):
    return {"result_id": result_id, "score": score, "created_at": "2020-01-01T00:00:00+00:00"}


@pytest.mark.parametrize("score,previous,baseline,priority,hours", [
    (15, None, None, "no_signal", None), (16, None, None, "review_required", 48),
    (14, 4, None, "review_required", 48), (14, 5, None, "no_signal", None),
    (16, 6, None, "urgent_review", 16), (16, 7, None, "review_required", 48),
    (14, 4, 3, "review_required", 48), (16, 15, 0, "urgent_review", 16),
    (16, 6, 0, "urgent_review", 16), (0, 20, 22, "no_signal", None),
])
def test_phq9_strict_threshold_and_two_families(score, previous, baseline, priority, hours):
    triage = assess_review(PHQ9_KEY, score, {"item9_positive": False},
        previous=reference(previous) if previous is not None else None,
        baseline=reference(baseline, 2) if baseline is not None else None)
    assert triage["severity"] == priority and triage["action_due_hours"] == hours
    assert len([item for item in triage["grounds"] if item["family"] == "growth"]) <= 1
    if previous is None:
        assert triage["comparison_previous"]["delta"] is None
    else:
        assert triage["comparison_previous"]["delta"] == score - previous
    assert triage["immediate_danger_established"] is False


def test_positive_item9_is_a_clarification_and_advisory_not_proven_immediate_danger():
    triage = assess_review(PHQ9_KEY, 1, {"item9_positive": True})
    assert triage["severity"] == "needs_clarification"
    assert triage["action_due_hours"] is None and triage["immediate_danger_established"] is False
    assert "12–24" in triage["advisory"][0]


@pytest.mark.parametrize("score,priority", [(9, "no_signal"), (10, "review_required"), (14, "review_required"), (15, "urgent_review"), (21, "urgent_review")])
def test_gad7_does_not_inherit_unapproved_phq9_deadlines(score, priority):
    triage = assess_review(GAD7_KEY, score, {})
    assert triage["severity"] == priority and triage["action_due_hours"] is None
    if score >= 10:
        assert any("не согласован" in item for item in triage["missing_data"])


async def complete(client, headers, key, answers, patient_id=1):
    _, assignment = await assigned(client, headers, key, patient_id)
    response = await client.post(f"/survey-assignments/{assignment}/submit", headers=headers(f"patient{patient_id}"), json={"answers": answers})
    assert response.status_code == 200, response.text
    return response


def numeric_answers(score):
    answers = values(9, 0)
    for i in range(1, 9):
        value = min(3, score)
        answers[f"q{i}"] = f"n{value}"
        score -= value
    assert score == 0
    return answers


async def test_baseline_is_explicit_scoped_revisioned_and_only_changes_future_comparisons(client, headers, database):
    await complete(client, headers, PHQ9_KEY, numeric_answers(0))
    initial = (await client.get("/patients/1/clinical-results", headers=headers("doctor"))).json()[0]
    path = f"/patients/1/clinical-baselines/{PHQ9_KEY}"
    baseline = (await client.get(path, headers=headers("doctor"))).json()
    assert baseline["result_id"] is None and baseline["revision"] == 0
    payload = {"result_id": initial["id"], "expected_revision": 0, "reason": "До согласованного курса"}
    for role, status in (("doctor2", 404), ("patient1", 403), ("admin", 403)):
        assert (await client.put(path, headers=headers(role), json=payload)).status_code == status
    saved = await client.put(path, headers=headers("doctor"), json=payload)
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert (await client.put(path, headers=headers("doctor"), json=payload)).json()["replayed"] is True
    await complete(client, headers, PHQ9_KEY, numeric_answers(10))
    await complete(client, headers, PHQ9_KEY, numeric_answers(16))
    rows = (await client.get("/patients/1/clinical-results", headers=headers("doctor"))).json()
    latest = rows[-1]
    assert latest["result"]["triage"]["comparison_previous"]["delta"] == 6
    assert latest["result"]["triage"]["comparison_baseline"]["delta"] == 16
    assert latest["result"]["triage"]["severity"] == "urgent_review"
    changed = {"result_id": latest["id"], "expected_revision": 0, "reason": "Новое начало наблюдения"}
    assert (await client.put(path, headers=headers("doctor"), json=changed)).status_code == 409
    changed["expected_revision"] = 1
    assert (await client.put(path, headers=headers("doctor"), json=changed)).json()["revision"] == 2
    assert (await client.get("/patients/1/clinical-results", headers=headers("doctor"))).json() == rows
    clear = {"result_id": None, "expected_revision": 2, "reason": "Выбор требует уточнения"}
    assert (await client.put(path, headers=headers("doctor"), json=clear)).json()["result_id"] is None
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalBaseline.id))) == 1


async def test_baseline_cannot_reference_another_patient_or_instrument(client, headers):
    await complete(client, headers, PHQ9_KEY, numeric_answers(0), patient_id=3)
    other = (await client.get("/patients/3/clinical-results", headers=headers("doctor"))).json()[0]
    path = f"/patients/1/clinical-baselines/{PHQ9_KEY}"
    payload = {"result_id": other["id"], "expected_revision": 0, "reason": "Проверка источника"}
    assert (await client.put(path, headers=headers("doctor"), json=payload)).status_code == 404
    await complete(client, headers, GAD7_KEY, values(7, 0))
    own = (await client.get("/patients/1/clinical-results", headers=headers("doctor"))).json()[0]
    payload["result_id"] = own["id"]
    assert (await client.put(path, headers=headers("doctor"), json=payload)).status_code == 404
    assert (await client.put(path, headers=headers("doctor"), json={**payload, "result_id": True})).status_code == 422


async def test_current_urgent_alert_requires_action_without_reusing_old_hour_deadlines(client, headers, database):
    await complete(client, headers, PHQ9_KEY, numeric_answers(0))
    response = await complete(client, headers, PHQ9_KEY, numeric_answers(16))
    assert await process_pending_events() == 1
    assert await process_pending_events() == 0
    alert = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    assert alert["source_kind"] == "clinical_assessment" and alert["severity"] == "urgent_review"
    timing = alert["review_timing"]
    assert timing["acknowledgement_due_at"] is None
    assert timing["action_due_at"] is None
    async with database() as session:
        result = await session.scalar(select(ClinicalResult).where(ClinicalResult.submission_id == response.json()["id"]))
        assert result.result["triage"]["response_target"] == "urgent"
        assert await session.scalar(select(func.count(Alert.id))) == 1
        assert await session.scalar(select(func.count(ClinicalDecision.id))) == 1
    for _ in range(2):
        assert (await client.post(f"/alerts/{alert['id']}/acknowledge", headers=headers("doctor"))).json()["status"] == "acknowledged"
    decision = alert["decision"]
    assert (await client.post(f"/clinical-decisions/{decision['id']}/confirm", headers=headers("doctor"), json={
        "action": "confirmed", "expected_version": decision["version"], "reason": "Нужен контакт"})).status_code == 200
    assert (await client.post(f"/alerts/{alert['id']}/close", headers=headers("doctor"))).status_code == 409
    current = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    assert current["status"] == "acknowledged" and current["closed_at"] is None
    command = await client.post(f"/alerts/{alert['id']}/actions", headers=headers("doctor"), json={
        "client_request_id": str(uuid4()), "title": "Контакт по результату PHQ-9", "kind": "clinical"})
    assert command.status_code == 201, command.text
    task_id = command.json()["task_id"]
    assert (await client.post(f"/alerts/{alert['id']}/close", headers=headers("doctor"))).status_code == 409
    done = await client.patch(f"/tasks/{task_id}", headers=headers("doctor"), json={
        "status": "done", "action_result": "Проведён синтетический контакт, дальнейший план согласован"})
    assert done.status_code == 200, done.text
    assert done.json()["verification_status"] == "pending"
    assert (await client.post(f"/alerts/{alert['id']}/close", headers=headers("doctor"))).json()["status"] == "closed"
    final = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    assert final["review_timing"]["action_completed_at"] is not None
    assert final["review_timing"]["action_overdue"] is False


async def test_item9_and_panic_events_are_not_emergencies_or_numeric_panic_scores(client, headers, database):
    await complete(client, headers, PHQ9_KEY, {**values(9, 0), "q9": "n1"})
    await complete(client, headers, PANIC_KEY, values(15, 1))
    assert await process_pending_events() == 2
    alerts = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()
    assert all(row["review_timing"]["acknowledgement_due_at"] is None for row in alerts)
    panic = next(row for row in alerts if row["decision"]["facts"]["form_type"] == "phq_panic")
    assert panic["decision"]["facts"]["score"] is None
    assert all(not row["decision"]["facts"]["triage"]["immediate_danger_established"] for row in alerts)


async def test_failed_award_leaves_no_clinical_outbox_or_partial_result(client, headers, database, monkeypatch):
    async def fail(*args, **kwargs):
        raise RuntimeError("controlled clinical award failure")
    monkeypatch.setattr("app.modules.surveys.service.grant_points", fail)
    _, assignment = await assigned(client, headers, PHQ9_KEY)
    with pytest.raises(RuntimeError, match="controlled clinical award failure"):
        await client.post(f"/survey-assignments/{assignment}/submit", headers=headers("patient1"), json={"answers": numeric_answers(16)})
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalResult.id))) == 0
        assert await session.scalar(select(func.count(OutboxEvent.id))) == 0


async def test_worker_retry_is_atomic_and_does_not_duplicate_the_clinical_event(client, headers, database, monkeypatch):
    from app.modules.alerts import clinical_review
    await complete(client, headers, GAD7_KEY, values(7, 3))
    original = clinical_review.record_event

    def fail(*args, **kwargs):
        raise RuntimeError("controlled review audit failure")

    monkeypatch.setattr(clinical_review, "record_event", fail)
    assert await process_pending_events() == 0
    async with database() as session:
        assert await session.scalar(select(func.count(Alert.id))) == 0
        assert await session.scalar(select(func.count(ClinicalDecision.id))) == 0
        event = await session.scalar(select(OutboxEvent))
        assert event.status == "pending" and event.attempts == 1
        event.next_attempt_at = datetime.now(timezone.utc)
        await session.commit()
    monkeypatch.setattr(clinical_review, "record_event", original)
    assert await process_pending_events() == 1
    assert await process_pending_events() == 0
    async with database() as session:
        assert await session.scalar(select(func.count(Alert.id))) == 1
        assert await session.scalar(select(func.count(ClinicalDecision.id))) == 1


async def test_legacy_version_string_cannot_claim_clinical_provenance(client, headers):
    response = await client.post("/assessments/responses", headers=headers("patient1"), json={
        "form_type": "phq9", "form_version": PHQ9_KEY, "answers": [3]*8+[0], "client_request_id": str(uuid4())})
    assert response.status_code == 201
    assert await process_pending_events() == 1
    alert = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    assert alert["source_kind"] == "assessment" and alert["rule_version"] == "backend_v0"
    assert alert["review_timing"]["acknowledgement_due_at"] is None
    assert (await client.get("/patients/1/clinical-results", headers=headers("doctor"))).json() == []


async def test_urgent_filter_is_applied_before_cursor_and_keeps_patient_scope(client, headers):
    await complete(client, headers, GAD7_KEY, values(7, 3))
    await complete(client, headers, GAD7_KEY, values(7, 3), patient_id=3)
    await complete(client, headers, GAD7_KEY, values(7, 2))
    assert await process_pending_events() == 3
    first = (await client.get("/alerts/inbox?priority=urgent&limit=1", headers=headers("doctor"))).json()
    assert first["total_open"] == 3 and first["urgent_open"] == 2
    assert first["selected_priority"] == "urgent" and len(first["items"]) == 1
    second = (await client.get(f"/alerts/inbox?priority=urgent&limit=1&before_id={first['next_before_id']}", headers=headers("doctor"))).json()
    assert len(second["items"]) == 1 and second["items"][0]["severity"] == "urgent_review"
    assert first["items"][0]["id"] != second["items"][0]["id"] and second["next_before_id"] is None
    other = (await client.get("/alerts/inbox?priority=urgent", headers=headers("doctor2"))).json()
    assert other["items"] == [] and other["urgent_open"] == 0
