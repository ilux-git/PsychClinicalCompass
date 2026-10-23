import asyncio
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select

from app.modules.analytics.privacy import PrivacyPolicyChange
from app.modules.surveys.models import SurveyAssignment, SurveySubmission


async def test_admin_can_version_privacy_without_getting_clinical_access(client, headers, database):
    initial = (await client.get("/admin/privacy-policy",headers=headers("admin"))).json()
    data = {"min_group_size":1,"reason":"Только синтетический показ","expected_revision":initial["revision"],"client_request_id":str(uuid4())}
    for role in ("doctor","patient1"):
        assert (await client.put("/admin/privacy-policy",headers=headers(role),json=data)).status_code == 403
    replies = await asyncio.gather(*[client.put("/admin/privacy-policy",headers=headers("admin"),json=data) for _ in range(3)])
    assert all(r.status_code == 200 for r in replies)
    revision = replies[0].json()["revision"]
    assert len({r.json()["revision"] for r in replies}) == 1
    summary = (await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert summary["status"] == "ready" and summary["workflow"]["values"]["treatment"]["unknown"] == 3
    assert "Иван" not in json.dumps(summary,ensure_ascii=False)
    assert (await client.get("/patients/1",headers=headers("admin"))).status_code == 403
    assert (await client.get("/analytics/care",headers=headers("admin"))).status_code == 403
    assert (await client.put("/admin/privacy-policy",headers=headers("admin"),json={**data,"client_request_id":str(uuid4())})).status_code == 409
    assert (await client.put("/admin/privacy-policy",headers=headers("admin"),json={**data,"client_request_id":str(uuid4()),"expected_revision":revision,"min_group_size":2})).status_code == 200
    body = (await client.get("/analytics/clinic",headers=headers("admin"))).json()
    # Source windows contain only one patient; a high count of events would not make that group safe.
    assert body["workflow"]["suppressed"] and body["workflow"]["values"] is None
    current = (await client.get("/admin/privacy-policy",headers=headers("admin"))).json()
    assert (await client.put("/admin/privacy-policy",headers=headers("admin"),json={**data,"client_request_id":str(uuid4()),"expected_revision":current["revision"],"min_group_size":None})).status_code == 200
    assert (await client.get("/analytics/clinic",headers=headers("admin"))).json()["status"] == "privacy_not_configured"
    assert (await client.put("/admin/privacy-policy",headers=headers("admin"),json={**data,"min_group_size":True})).status_code == 422
    async with database() as session:
        assert await session.scalar(select(func.count(PrivacyPolicyChange.id))) == 3


async def test_doctor_metrics_use_mature_denominators_and_separate_outcomes(client, headers, database):
    now = datetime.now(timezone.utc)
    q = {"title":"Сроки","questions":[{"id":"a","kind":"single","prompt":"Ответ","options":[{"id":"yes","label":"Да"},{"id":"no","label":"Нет"}]}]}
    survey = (await client.post("/surveys",headers=headers("doctor"),json=q)).json()
    await client.post(f"/surveys/{survey['id']}/publish",headers=headers("doctor"))
    ids = []
    for due in (now-timedelta(days=1),now-timedelta(days=1),now+timedelta(days=3)):
        a = (await client.post(f"/surveys/{survey['id']}/assign",headers=headers("doctor"),json={"patient_ids":[1],"due_at":due.isoformat(),"client_request_id":str(uuid4())})).json()["assignment_ids"][0]
        ids.append(a)
        await client.post(f"/survey-assignments/{a}/submit",headers=headers("patient1"),json={"answers":{"a":"yes"}})
    async with database() as session:
        row = await session.scalar(select(SurveySubmission).where(SurveySubmission.assignment_id == ids[0]))
        row.created_at = now-timedelta(days=2)
        await session.commit()
    await client.post("/patients/1/treatment-status",headers=headers("doctor"),json={"status":"completed","reason":"Врач подтвердил завершение","expected_revision":0,"client_request_id":str(uuid4())})
    metrics = (await client.get("/analytics/care",headers=headers("doctor"))).json()
    assert metrics["survey_on_time"] == {"numerator":1,"denominator":2,"percent":50.0,"without_due":0}
    assert metrics["treatment"] == {"in_progress":0,"completed":1,"refused":0,"unknown":1,"source":"doctor_decision"}
    assert metrics["visits"]["cancelled"] == 1 and metrics["visits"]["no_show"] == 0
    assert metrics["visits"]["contact_in_window"]["denominator"] == 1
    assert metrics["medication"]["statuses"].get("not_taken",0) == 0
    second = (await client.get("/analytics/care",headers=headers("doctor2"))).json()
    assert second["treatment"]["completed"] == 0 and second["visits"]["attended"] == 1


async def test_mutually_exclusive_answers_cannot_mix_absence_with_barrier(client, headers):
    body = {"title":"Барьеры","questions":[{"id":"barrier","kind":"multiple","prompt":"Что мешало?","dimension":"constraints",
        "options":[{"id":"time","label":"Время","analytics_category":"time"},{"id":"none","label":"Ничего","analytics_category":"none","exclusive":True}]}]}
    survey = (await client.post("/surveys",headers=headers("doctor"),json=body)).json()
    await client.post(f"/surveys/{survey['id']}/publish",headers=headers("doctor"))
    a = (await client.post(f"/surveys/{survey['id']}/assign",headers=headers("doctor"),json={"patient_ids":[1],"client_request_id":str(uuid4())})).json()["assignment_ids"][0]
    assert (await client.post(f"/survey-assignments/{a}/submit",headers=headers("patient1"),json={"answers":{"barrier":["time","none"]}})).status_code == 422
    assert (await client.post(f"/survey-assignments/{a}/submit",headers=headers("patient1"),json={"answers":{"barrier":["none"]}})).status_code == 200
