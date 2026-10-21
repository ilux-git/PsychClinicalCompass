import asyncio
from uuid import uuid4

from sqlalchemy import func, select

from app.db.demo_data import BARRIER_QUESTIONS
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.surveys.models import SurveySubmission


async def published(client, headers, doctor="doctor"):
    response = await client.post("/surveys", headers=headers(doctor), json={
        "title":"Собственный опрос", "purpose":"barriers", "questions":BARRIER_QUESTIONS})
    assert response.status_code == 201
    survey = response.json()
    assert (await client.post(f"/surveys/{survey['id']}/publish", headers=headers(doctor))).status_code == 200
    return survey


async def assigned(client, headers, survey, ids=None):
    response = await client.post(f"/surveys/{survey['id']}/assign", headers=headers("doctor"), json={
        "patient_ids": ids or [1], "client_request_id":str(uuid4())})
    assert response.status_code == 201
    return response.json()["assignment_ids"]


async def test_draft_publish_immutable_and_new_version(client, headers):
    survey = await published(client, headers)
    path = f"/surveys/{survey['id']}"
    assert (await client.put(path, headers=headers("doctor"), json={"title":"changed", "questions":BARRIER_QUESTIONS})).status_code == 409
    assert (await client.post(path+"/publish", headers=headers("doctor2"))).status_code == 404
    copy = (await client.post(path+"/copy", headers=headers("doctor"))).json()
    assert copy["version"] == 2 and copy["published_at"] is None and copy["previous_version_id"] == survey["id"]
    assert (await client.put(f"/surveys/{copy['id']}", headers=headers("doctor"), json={
        "title":"Новая версия", "questions":BARRIER_QUESTIONS})).status_code == 200
    assert (await client.get("/surveys", headers=headers("doctor2"))).json() == []


async def test_assign_requires_own_patient_and_is_idempotent(client, headers):
    survey = await published(client, headers)
    path = f"/surveys/{survey['id']}/assign"
    payload = {"patient_ids":[1], "client_request_id":str(uuid4())}
    first = await client.post(path, headers=headers("doctor"), json=payload)
    second = await client.post(path, headers=headers("doctor"), json=payload)
    assert first.json() == second.json()
    assert len((await client.get("/survey-assignments", headers=headers("patient1"))).json()) == 1


async def test_assign_batch_replay_cannot_expand_or_shrink(client, headers):
    survey = await published(client, headers)
    path = f"/surveys/{survey['id']}/assign"
    payload = {"patient_ids": [3, 1], "client_request_id": str(uuid4())}
    first, retry = await asyncio.gather(*[client.post(path, headers=headers("doctor"), json=payload) for _ in range(2)])
    assert first.status_code == retry.status_code == 201
    assert first.json() == retry.json()
    payload["patient_ids"] = [1]
    assert (await client.post(path, headers=headers("doctor"), json=payload)).status_code == 409
    assert len((await client.get("/survey-assignments", headers=headers("doctor"))).json()) == 2
    payload["patient_ids"] = [1, 2]
    assert (await client.post(path, headers=headers("doctor"), json=payload)).status_code == 404
    assert len((await client.get("/survey-assignments", headers=headers("patient1"))).json()) == 1


async def test_submit_scope_validation_and_no_double_progress(client, headers, database):
    survey = await published(client, headers)
    assignment = (await assigned(client, headers, survey))[0]
    path = f"/survey-assignments/{assignment}/submit"
    answers = {"answers":{"barriers":["cost"], "details":"Мне дорого"}}
    assert (await client.post(path, headers=headers("patient2"), json=answers)).status_code == 404
    assert (await client.post(path, headers=headers("doctor"), json=answers)).status_code == 403
    assert (await client.post(path, headers=headers("patient1"), json={"answers":{"barriers":["unknown"]}})).status_code == 422
    results = await asyncio.gather(*[client.post(path, headers=headers("patient1"), json=answers) for _ in range(2)])
    assert [r.status_code for r in results] == [200, 200]
    assert sorted(r.json()["replayed"] for r in results) == [False, True]
    assert results[0].json()["id"] == results[1].json()["id"]
    changed = await client.post(path, headers=headers("patient1"), json={"answers":{"barriers":["none"]}})
    assert changed.status_code == 409
    progress = (await client.get("/participation/me", headers=headers("patient1"))).json()
    assert progress["completed"] == 1 and progress["progress_percent"] == 100
    assert progress["commercial_rewards_enabled"] is False
    async with database() as session:
        assert await session.scalar(select(func.count(SurveySubmission.id))) == 1
        assert await session.scalar(select(func.count(QuestionnaireResponse.id))) == 0


async def test_analytics_reports_reasons_not_inferred_churn(client, headers):
    survey = await published(client, headers)
    assignments = await assigned(client, headers, survey, [1, 3])
    await client.post(f"/survey-assignments/{assignments[0]}/submit", headers=headers("patient1"),
                      json={"answers":{"barriers":["cost", "schedule"], "details":"Изменился график"}})
    report = (await client.get("/analytics/engagement", headers=headers("doctor"))).json()
    assert (report["assigned"], report["completed"], report["pending"], report["completion_rate"]) == (2,1,1,50)
    assert report["churn_status"] == "definition_pending"
    chart = next(q for q in report["questions"] if q["question_id"] == "barriers")
    assert chart["respondents"] == 1
    assert {o["id"]:o["count"] for o in chart["options"]}["cost"] == 1
    unknown = next(p for p in report["patients"] if p["id"] == 3)
    assert unknown["observation_status"] == "unknown"
    assert (await client.get("/analytics/engagement", headers=headers("doctor2"))).json()["quotes"] == []
    future = (await client.get("/analytics/engagement?since=2099-01-01T00:00:00Z", headers=headers("doctor"))).json()
    assert future["assigned"] == 0 and future["completion_rate"] is None
    assert (await client.get("/analytics/engagement?since=2026-01-01T00:00:00", headers=headers("doctor"))).status_code == 422
