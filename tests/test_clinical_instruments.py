import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalResult
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.audit.models import AuditEvent
from app.modules.surveys.models import Survey, SurveySubmission


async def assigned(client, headers, key, patient_id=1):
    response = await client.post(f"/clinical-instruments/{key}/survey", headers=headers("doctor"), json={})
    assert response.status_code == 200, response.text
    survey = response.json()
    response = await client.post(f"/surveys/{survey['id']}/assign", headers=headers("doctor"), json={
        "patient_ids": [patient_id], "client_request_id": str(uuid4())})
    assert response.status_code == 201, response.text
    return survey, response.json()["assignment_ids"][0]


def values(count, value):
    return {f"q{i}": f"n{value}" for i in range(1, count + 1)}


async def test_catalog_versions_cannot_be_forged_or_changed(client, headers, database):
    response = await client.get("/clinical-instruments", headers=headers("doctor"))
    assert response.status_code == 200
    catalog = {item["key"]: item for item in response.json()}
    assert set(catalog) == {PHQ9_KEY, GAD7_KEY, PANIC_KEY}
    assert len(catalog[PHQ9_KEY]["questions"]) == 9
    assert catalog[PHQ9_KEY]["questions"][5]["prompt"] == "Плохое мнение о себе или чувство, что не смог оправдать ожиданий моей семьи"
    assert catalog[GAD7_KEY]["questions"][0]["options"][2]["label"] == "Более половины дней"
    for role in ("patient1", "admin"):
        assert (await client.get("/clinical-instruments", headers=headers(role))).status_code == 403
        assert (await client.post(f"/clinical-instruments/{PHQ9_KEY}/survey", headers=headers(role), json={})).status_code == 403
    assert (await client.post("/clinical-instruments/unknown/survey", headers=headers("doctor"), json={})).status_code == 404
    requests = await asyncio.gather(*[
        client.post(f"/clinical-instruments/{PHQ9_KEY}/survey", headers=headers("doctor"), json={}) for _ in range(3)])
    assert all(r.status_code == 200 for r in requests)
    assert len({r.json()["id"] for r in requests}) == 1
    survey = requests[0].json()
    assert survey["is_clinical_scale"] and survey["clinical_instrument"]["key"] == PHQ9_KEY
    assert (await client.put(f"/surveys/{survey['id']}", headers=headers("doctor"), json={
        "title": "Изменён", "questions": survey["questions"]})).status_code == 409
    assert (await client.post(f"/surveys/{survey['id']}/copy", headers=headers("doctor"))).status_code == 409
    forged = await client.post("/surveys", headers=headers("doctor"), json={
        "title": survey["title"], "questions": survey["questions"], "clinical_key": PHQ9_KEY,
        "is_clinical_scale": True, "clinical_instrument": catalog[PHQ9_KEY]})
    assert forged.status_code == 201
    assert forged.json()["clinical_instrument"] is None and forged.json()["is_clinical_scale"] is False
    async with database() as session:
        assert await session.scalar(select(func.count(Survey.id)).where(Survey.clinical_key == PHQ9_KEY)) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "clinical_survey.added")) == 1


@pytest.mark.parametrize("key,count,value,score,band", [
    (PHQ9_KEY, 9, 0, 0, None), (PHQ9_KEY, 9, 3, 27, None),
    (GAD7_KEY, 7, 0, 0, "Минимальный"), (GAD7_KEY, 7, 1, 7, "Умеренный"),
    (GAD7_KEY, 7, 2, 14, "Средний"), (GAD7_KEY, 7, 3, 21, "Высокий"),
])
async def test_complete_numeric_form_and_scoped_history(client, headers, database, key, count, value, score, band):
    survey, assignment = await assigned(client, headers, key)
    answers = values(count, value)
    path = f"/survey-assignments/{assignment}/submit"
    assert (await client.post(path, headers=headers("patient2"), json={"answers": answers})).status_code == 404
    first, retry = await asyncio.gather(*[
        client.post(path, headers=headers("patient1"), json={"answers": answers}) for _ in range(2)])
    assert first.status_code == retry.status_code == 200
    assert sorted([first.json()["replayed"], retry.json()["replayed"]]) == [False, True]
    for role in ("doctor", "patient1"):
        history = (await client.get("/patients/1/clinical-results", headers=headers(role))).json()
        assert len(history) == 1
        row = history[0]
        assert row["score"] == score and row["answers"] == answers
        assert row["definition"] == survey["clinical_instrument"]
        assert row["result"].get("band") == band
        if key == PHQ9_KEY:
            assert row["result"]["item9_positive"] == (value > 0)
    for role, status in (("doctor2", 404), ("patient2", 404), ("admin", 403)):
        assert (await client.get("/patients/1/clinical-results", headers=headers(role))).status_code == status
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalResult.id))) == 1
        assert await session.scalar(select(func.count(QuestionnaireResponse.id))) == 0


@pytest.mark.parametrize("answers", [
    {}, {**values(9, 0), "q10": "n0"}, {**values(9, 0), "q3": 0},
    {**values(9, 0), "q3": False}, {**values(9, 0), "q3": "n4"}, {"q1": "n0"},
])
async def test_incomplete_or_noncanonical_answer_is_not_scored(client, headers, database, answers):
    _, assignment = await assigned(client, headers, PHQ9_KEY)
    response = await client.post(f"/survey-assignments/{assignment}/submit", headers=headers("patient1"), json={"answers": answers})
    assert response.status_code == 422
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalResult.id))) == 0
        assert await session.scalar(select(func.count(SurveySubmission.id))) == 0


@pytest.mark.parametrize("gates,symptoms,positive", [(4, 4, True), (4, 3, False), (3, 11, False), (4, 11, True)])
async def test_panic_uses_gates_and_symptoms_not_a_severity_sum(client, headers, gates, symptoms, positive):
    _, assignment = await assigned(client, headers, PANIC_KEY)
    answers = {f"q{i}": "n1" if i <= gates else "n0" for i in range(1, 5)}
    answers.update({f"q{i}": "n1" if i < 5 + symptoms else "n0" for i in range(5, 16)})
    response = await client.post(f"/survey-assignments/{assignment}/submit", headers=headers("patient1"), json={"answers": answers})
    assert response.status_code == 200, response.text
    row = (await client.get("/patients/1/clinical-results", headers=headers("doctor"))).json()[0]
    assert row["score"] is None
    assert {key: value for key, value in row["result"].items() if key != "triage"} == {"kind": "panic_screen", "criterion_met": positive, "screen_stopped": False,
                             "gates_yes": gates, "symptoms_yes": symptoms}


async def test_panic_skip_does_not_manufacture_negative_symptoms(client, headers):
    _, assignment = await assigned(client, headers, PANIC_KEY)
    path = f"/survey-assignments/{assignment}"
    assert (await client.put(path + "/draft", headers=headers("patient1"), json={
        "answers": {"q1": "n1", "q2": "n1"}, "expected_revision": 0})).status_code == 200
    assert (await client.post(path + "/submit", headers=headers("patient1"), json={
        "answers": {"q1": "n0", "q2": "n0"}, "expected_draft_revision": 1})).status_code == 422
    assert (await client.post(path + "/submit", headers=headers("patient1"), json={
        "answers": {"q1": "n0"}, "expected_draft_revision": 1})).status_code == 200
    row = (await client.get("/patients/1/clinical-results", headers=headers("patient1"))).json()[0]
    assert row["answers"] == {"q1": "n0"}
    assert row["score"] is None and row["result"]["symptoms_yes"] is None
    assert row["result"]["gates_yes"] is None and row["result"]["screen_stopped"] is True


async def test_tampered_canonical_form_fails_closed(client, headers, database):
    survey, assignment = await assigned(client, headers, PHQ9_KEY)
    async with database() as session:
        row = await session.get(Survey, survey["id"])
        row.questions = [{**q, "prompt": "Подменённый текст"} for q in row.questions]
        await session.commit()
    response = await client.post(f"/survey-assignments/{assignment}/submit", headers=headers("patient1"), json={"answers": values(9, 0)})
    assert response.status_code == 409
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalResult.id))) == 0


async def test_panic_award_is_independent_of_screening_answers(client, headers):
    receipts = []
    for patient_id, answers in [(1, {"q1": "n0"}), (3, values(15, 1))]:
        _, assignment = await assigned(client, headers, PANIC_KEY, patient_id)
        response = await client.post(f"/survey-assignments/{assignment}/submit", headers=headers(f"patient{patient_id}"), json={"answers": answers})
        assert response.status_code == 200
        receipts.append(response.json()["participation"])
    assert receipts[0]["points"] == receipts[1]["points"] == 15
    assert all(receipt["policy_version"] == "demo-clinical-completion-v1" for receipt in receipts)


async def test_failure_after_scoring_rolls_back_submission_result_and_award(client, headers, database, monkeypatch):
    _, assignment = await assigned(client, headers, PHQ9_KEY)

    async def fail_award(*args, **kwargs):
        raise RuntimeError("controlled award failure")

    monkeypatch.setattr("app.modules.surveys.service.grant_points", fail_award)
    with pytest.raises(RuntimeError, match="controlled award failure"):
        await client.post(f"/survey-assignments/{assignment}/submit", headers=headers("patient1"), json={"answers": values(9, 0)})
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalResult.id))) == 0
        assert await session.scalar(select(func.count(SurveySubmission.id))) == 0
