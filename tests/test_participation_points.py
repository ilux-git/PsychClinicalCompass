import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.adherence.models import DiaryEntry
from app.modules.adherence.rewards import ParticipationAward


async def balance(client, headers, who="patient1"):
    response = await client.get("/participation/points", headers=headers(who))
    assert response.status_code == 200
    return response.json()


async def test_diary_points_are_capped_and_independent_of_sharing_and_feeling(client, headers, database):
    assert (await balance(client,headers))["balance"] == 0
    common = {"text": "", "observed_at": datetime.now(timezone.utc).isoformat(), "observation_kind": "moment", "feeling": "difficult"}
    payloads = [{**common, "client_request_id": str(uuid4()), "shared_with_doctor": False} for _ in range(5)]
    responses = await asyncio.gather(*[client.post("/diary/entries",headers=headers("patient1"),json=p) for p in payloads])
    assert all(r.status_code == 201 for r in responses)
    points = await balance(client,headers)
    assert points["balance"] == 3 and sum(r["points"] for r in points["history"]) == 3
    shared = await client.post("/diary/entries", headers=headers("patient3"), json={**common,
        "client_request_id": str(uuid4()), "shared_with_doctor": True, "feeling": "very_good"})
    assert shared.status_code == 201 and (await balance(client,headers,"patient3"))["balance"] == 3
    replay = await client.post("/diary/entries", headers=headers("patient1"), json=payloads[0])
    assert replay.status_code == 201 and replay.json()["replayed"]
    assert (await balance(client,headers))["balance"] == 3
    assert (await client.get("/patients/1/diary",headers=headers("doctor"))).json()["entries"] == []
    for role in ("doctor", "admin"):
        assert (await client.get("/participation/points",headers=headers(role))).status_code == 403
    async with database() as session:
        assert await session.scalar(select(func.count(DiaryEntry.id))) == 6


async def test_survey_points_depend_on_effort_not_answer_or_risk(client, headers):
    questions = [{"id": "a", "kind": "single", "prompt": "Получилось?", "options": [{"id":"yes","label":"Да"},{"id":"no","label":"Нет"}]},
                 {"id":"b","kind":"text","prompt":"Комментарий","required":False}]
    survey = (await client.post("/surveys",headers=headers("doctor"),json={"title":"Обратная связь","questions":questions})).json()
    await client.post(f"/surveys/{survey['id']}/publish",headers=headers("doctor"))
    ids = (await client.post(f"/surveys/{survey['id']}/assign",headers=headers("doctor"),json={"patient_ids":[1,3],"client_request_id":str(uuid4())})).json()["assignment_ids"]
    for assignment, who, answer in zip(ids,("patient1","patient3"),("no","yes")):
        data = {"answers":{"a":answer,"b":"Честный комментарий"}}
        results = await asyncio.gather(*[client.post(f"/survey-assignments/{assignment}/submit",headers=headers(who),json=data) for _ in range(2)])
        assert all(r.status_code == 200 for r in results)
        assert (await balance(client,headers,who))["balance"] == 3
    # Clinical numeric forms have equal effort whatever the answers, without a reward for symptoms.
    for who, answers in (("patient1",[0]*9),("patient3",[1]*9)):
        data = {"form_type":"phq9","form_version":"demo_numeric_v1","answers":answers,"client_request_id":str(uuid4())}
        assert (await client.post("/assessments/responses",headers=headers(who),json=data)).status_code == 201
        assert (await client.post("/assessments/responses",headers=headers(who),json=data)).status_code == 201
        assert (await balance(client,headers,who))["balance"] == 12


async def test_parallel_distinct_assessments_obey_daily_cap_without_losing_responses(client, headers, database):
    payloads = [{"form_type":"phq9","form_version":"demo_numeric_v1","answers":[0]*9,"client_request_id":str(uuid4())} for _ in range(5)]
    responses = await asyncio.wait_for(asyncio.gather(*[client.post("/assessments/responses",headers=headers("patient1"),json=p) for p in payloads]),timeout=20)
    assert all(r.status_code == 201 for r in responses)
    points = await balance(client,headers)
    assert points["balance"] == 30 and len(points["history"]) == 5
    assert not points["exchange_enabled"] and points["policy_status"] == "demo_proposal"


async def test_points_failure_rolls_back_the_underlying_diary(client, headers, database, monkeypatch):
    import app.modules.adherence.rewards as rewards
    def fail(*args, **kwargs): raise RuntimeError("Injected points audit failure")
    monkeypatch.setattr(rewards,"record_event",fail)
    with pytest.raises(RuntimeError,match="Injected points audit failure"):
        await client.post("/diary/entries",headers=headers("patient1"),json={"text":"Atomic entry","client_request_id":str(uuid4())})
    async with database() as session:
        assert await session.scalar(select(func.count(DiaryEntry.id))) == 0
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 0


async def test_structured_diary_requires_actual_observation_and_keeps_source_time(client, headers):
    original = {"client_request_id":str(uuid4()),"text":"","feeling":"neutral","observation_kind":"day_summary","observed_at":"2026-10-20T20:00:00+07:00"}
    first = await client.post("/diary/entries",headers=headers("patient1"),json=original)
    assert first.status_code == 201 and first.json()["observed_at"].startswith("2026-10-20T13:00:00")
    assert first.json()["observation_kind"] == "day_summary" and not first.json()["is_clinical_scale"]
    assert (await client.post("/diary/entries",headers=headers("patient1"),json={**original,"feeling":"good"})).status_code == 409
    assert (await client.post("/diary/entries",headers=headers("patient1"),json={"client_request_id":str(uuid4()),"text":" "})).status_code == 422
    assert (await client.post("/diary/entries",headers=headers("patient1"),json={"client_request_id":str(uuid4()),"feeling":"good"})).status_code == 422
