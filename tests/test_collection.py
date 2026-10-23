import asyncio
from datetime import datetime, timedelta, timezone
import json
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.modules.adherence.models import DiaryEntry
from app.modules.audit.models import AuditEvent
from app.modules.notes.models import DoctorNote
from app.modules.surveys.models import SurveyAssignment, SurveySubmission

QUESTIONS = [
    {"id":"ready", "prompt":"PRIVATE readiness prompt", "kind":"scale", "minimum":0,"maximum":10,"dimension":"readiness"},
    {"id":"trust", "prompt":"PRIVATE approach prompt", "kind":"single", "dimension":"approach_trust", "options":[
        {"id":"yes","label":"PRIVATE yes"}, {"id":"unknown","label":"PRIVATE unknown"}]},
    {"id":"barriers", "prompt":"PRIVATE barriers prompt", "kind":"multiple", "dimension":"constraints", "options":[
        {"id":"cost","label":"PRIVATE cost","analytics_category":"financial"},
        {"id":"schedule","label":"PRIVATE schedule","analytics_category":"time"}]},
    {"id":"consistency", "prompt":"PRIVATE consistency prompt", "kind":"text", "required":False,"dimension":"recommendation_consistency"},
]
ANSWERS = {"ready":3,"trust":"unknown","barriers":["cost","schedule"]}


async def survey_and_assign(client, headers, patient_ids=None):
    result = await client.post("/surveys", headers=headers("doctor"), json={"title":"PRIVATE title","questions":QUESTIONS})
    assert result.status_code == 201
    survey = result.json()
    assert (await client.post(f'/surveys/{survey["id"]}/publish', headers=headers("doctor"))).status_code == 200
    result = await client.post(f'/surveys/{survey["id"]}/assign', headers=headers("doctor"), json={
        "patient_ids":patient_ids or [1],"client_request_id":str(uuid4())})
    assert result.status_code == 201
    return survey, result.json()["assignment_ids"]


async def test_open_is_owned_patient_only_and_concurrent_replay_preserves_time(client, headers, database):
    _, ids = await survey_and_assign(client, headers)
    path = f"/survey-assignments/{ids[0]}/open"
    listed = (await client.get("/survey-assignments", headers=headers("patient1"))).json()
    assert listed[0]["first_opened_at"] is None  # Listing is not opening a form.
    for role, code in (("doctor",403),("admin",403),("patient2",404)):
        assert (await client.post(path, headers=headers(role))).status_code == code
    replies = await asyncio.gather(*[client.post(path, headers=headers("patient1"), json={"first_opened_at":"1900-01-01"}) for _ in range(2)])
    assert all(reply.status_code == 200 for reply in replies)
    assert replies[0].json() == replies[1].json() and replies[0].json()["first_opened_at"].startswith("20")
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type=="survey.opened")) == 1


async def test_legacy_completion_cannot_get_fabricated_open_time(client, headers, database):
    _, ids = await survey_and_assign(client, headers)
    prefix = f"/survey-assignments/{ids[0]}"
    assert (await client.post(prefix+"/submit",headers=headers("patient1"),json={"answers":ANSWERS})).status_code == 200
    result = (await client.post(prefix+"/open", headers=headers("patient1"))).json()
    assert result["already_completed"] and result["first_opened_at"] is None
    report = (await client.get("/analytics/engagement",headers=headers("doctor"))).json()["collection"]
    assert report["journey"]["completed_without_open_record"] == 1
    assert report["journey"]["open_to_completion"] == {"known":0,"unknown":1,"median_seconds":None}
    assert all(item["inferred_score"] is None for item in report["dimensions"])


async def test_journey_denominators_durations_and_four_dimensions(client, headers, database):
    survey, ids = await survey_and_assign(client, headers, [1,3])
    for assignment, patient in zip(ids, ("patient1","patient3")):
        assert (await client.post(f"/survey-assignments/{assignment}/submit",headers=headers(patient),json={"answers":ANSWERS})).status_code == 200
    extra = (await client.post(f'/surveys/{survey["id"]}/assign',headers=headers("doctor"),json={"patient_ids":[3],"client_request_id":str(uuid4())})).json()["assignment_ids"][0]
    start = datetime(2026,1,1,tzinfo=timezone.utc)
    async with database() as session:
        await session.execute(update(SurveyAssignment).values(created_at=start))
        await session.execute(update(SurveyAssignment).where(SurveyAssignment.id.in_([ids[0],extra])).values(first_opened_at=start+timedelta(seconds=60)))
        await session.execute(update(SurveySubmission).where(SurveySubmission.assignment_id==ids[0]).values(created_at=start+timedelta(seconds=90)))
        await session.execute(update(SurveySubmission).where(SurveySubmission.assignment_id==ids[1]).values(created_at=start+timedelta(seconds=180)))
        await session.commit()
    collection = (await client.get("/analytics/engagement",headers=headers("doctor"))).json()["collection"]
    j = collection["journey"]
    assert (j["assigned"],j["opened"],j["completed"],j["completed_after_open"],j["opened_not_completed"]) == (3,2,2,1,1)
    assert j["completion_after_open_percent"] == 50
    assert j["assignment_to_completion"] == {"known":2,"unknown":0,"median_seconds":135.0}
    assert j["open_to_completion"] == {"known":1,"unknown":1,"median_seconds":30.0}
    assert j["delivery_to_completion"]["median_seconds"] is None
    by_code = {d["code"]:d for d in collection["dimensions"]}
    assert by_code["readiness"]["responding_patients"] == 2 and by_code["readiness"]["answers"] == 2
    assert by_code["recommendation_consistency"]["responding_patients"] == 0
    assert by_code["recommendation_consistency"]["patients_without_answer"] == 2
    assert (await client.get("/analytics/engagement",headers=headers("doctor2"))).json()["collection"]["journey"]["assigned"] == 0


async def test_published_analytics_tags_are_immutable_and_copied(client, headers):
    survey, _ = await survey_and_assign(client, headers)
    path=f'/surveys/{survey["id"]}'
    assert (await client.put(path,headers=headers("doctor"),json={"title":"Changed","questions":QUESTIONS})).status_code == 409
    copied=(await client.post(path+"/copy",headers=headers("doctor"))).json()
    assert copied["questions"][0]["dimension"] == "readiness"
    assert copied["questions"][2]["options"][0]["analytics_category"] == "financial"
    invalid={**QUESTIONS[0],"dimension":"loyalty_from_response_speed"}
    assert (await client.post("/surveys",headers=headers("doctor"),json={"title":"Invalid","questions":[invalid]})).status_code == 422


async def test_private_doctor_observation_links_message_without_overwriting_patient(client, headers, database):
    _, ids = await survey_and_assign(client, headers)
    await client.post(f'/survey-assignments/{ids[0]}/submit',headers=headers("patient1"),json={"answers":ANSWERS})
    message=(await client.post("/conversations/1/messages",headers=headers("patient1"),json={"text":"PRIVATE patient message","channel":"web"})).json()
    payload={"text":"PRIVATE clinician observation","dimension":"constraints","source_type":"message","source_id":message["id"]}
    result=await client.post("/patients/1/notes",headers=headers("doctor"),json=payload)
    assert result.status_code==201 and result.json()["source"]=="doctor_observation"
    assert result.json()["dimension"]=="constraints"
    for role in ("patient1","admin"):
        assert (await client.get("/patients/1/notes",headers=headers(role))).status_code==403
    assert (await client.post("/patients/2/notes",headers=headers("doctor2"),json=payload)).status_code==404
    async with database() as session:
        assert (await session.scalar(select(SurveySubmission))).answers==ANSWERS
        assert await session.scalar(select(func.count(DoctorNote.id)))==1


async def test_diary_private_by_default_and_patient_controls_sharing(client, headers, database):
    payload={"text":"PRIVATE diary text","client_request_id":str(uuid4())}
    replies=await asyncio.gather(*[client.post("/diary/entries",headers=headers("patient1"),json=payload) for _ in range(2)])
    assert all(r.status_code==201 for r in replies)
    entry=replies[0].json()
    assert not entry["shared_with_doctor"] and replies[1].json()["id"]==entry["id"]
    assert (await client.get("/patients/1/diary",headers=headers("doctor"))).json()["entries"]==[]
    for role,code in (("doctor2",404),("patient2",404),("admin",403)):
        assert (await client.get("/patients/1/diary",headers=headers(role))).status_code==code
    path=f'/diary/entries/{entry["id"]}/sharing'
    assert (await client.patch(path,headers=headers("doctor"),json={"shared_with_doctor":True})).status_code==403
    assert (await client.patch(path,headers=headers("patient2"),json={"shared_with_doctor":True})).status_code==404
    assert (await client.patch(path,headers=headers("patient1"),json={"shared_with_doctor":True})).status_code==200
    assert len((await client.get("/patients/1/diary",headers=headers("doctor"))).json()["entries"])==1
    assert (await client.patch(path,headers=headers("patient1"),json={"shared_with_doctor":False})).status_code==200
    assert (await client.get("/patients/1/diary",headers=headers("doctor"))).json()["entries"]==[]
    assert len((await client.get("/patients/1/diary",headers=headers("patient1"))).json()["entries"])==1
    retry=await client.post("/diary/entries",headers=headers("patient1"),json=payload)
    assert retry.json()["replayed"] and not retry.json()["shared_with_doctor"]
    assert (await client.post("/diary/entries",headers=headers("patient1"),json={**payload,"text":"Changed"})).status_code==409
    async with database() as session:
        assert await session.scalar(select(func.count(DiaryEntry.id)))==1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type=="diary.created"))==1


@pytest.mark.parametrize("domain", ["opening","diary"])
async def test_collection_event_and_audit_rollback_together(client, headers, database, monkeypatch, domain):
    if domain=="opening":
        _,ids=await survey_and_assign(client,headers)
        import app.modules.surveys.router as module
        path,payload=f'/survey-assignments/{ids[0]}/open',{}
    else:
        import app.modules.adherence.router as module
        path,payload="/diary/entries",{"text":"Atomic diary","client_request_id":str(uuid4())}
    def fail(*args,**kwargs): raise RuntimeError("Injected audit failure")
    monkeypatch.setattr(module,"record_event",fail)
    with pytest.raises(RuntimeError,match="Injected audit failure"):
        await client.post(path,headers=headers("patient1"),json=payload)
    async with database() as session:
        assert await session.scalar(select(func.count(DiaryEntry.id)))==0
        assert await session.scalar(select(func.count(SurveyAssignment.id)).where(SurveyAssignment.first_opened_at.is_not(None)))==0


async def test_admin_summary_stays_closed_until_policy_and_never_exposes_text(client,headers,monkeypatch):
    _, ids = await survey_and_assign(client,headers,[1,3])
    await client.post(f'/survey-assignments/{ids[0]}/submit', headers=headers("patient1"),
                      json={"answers":{**ANSWERS,"consistency":"PRIVATE patient answer"}})
    await client.post("/patients/1/notes",headers=headers("doctor"),json={"text":"PRIVATE clinician note","dimension":"readiness"})
    await client.post("/diary/entries",headers=headers("patient1"),json={"text":"PRIVATE diary","client_request_id":str(uuid4()),"shared_with_doctor":True})
    monkeypatch.setattr(get_settings(),"admin_analytics_min_group_size",None)
    body=(await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert body["status"]=="privacy_not_configured" and body["cohort"] is None and body["journey"] is None
    monkeypatch.setattr(get_settings(),"admin_analytics_min_group_size",1)  # Test policy, not a product default.
    body=(await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert body["cohort"]["values"]["patients"]==3
    assert "PRIVATE" not in json.dumps(body) and "Иван" not in json.dumps(body,ensure_ascii=False)
    for role in ("doctor","patient1"):
        assert (await client.get("/analytics/clinic",headers=headers(role))).status_code==403
    assert (await client.get("/analytics/clinic?patient_id=1",headers=headers("admin"))).status_code==422


async def test_admin_suppression_uses_people_and_complements_not_response_count(client,headers,monkeypatch):
    survey,ids=await survey_and_assign(client,headers)
    for _ in range(3):
        await client.post(f'/survey-assignments/{ids[0]}/submit',headers=headers("patient1"),json={"answers":ANSWERS})
        ids=(await client.post(f'/surveys/{survey["id"]}/assign',headers=headers("doctor"),json={"patient_ids":[1],"client_request_id":str(uuid4())})).json()["assignment_ids"]
    monkeypatch.setattr(get_settings(),"admin_analytics_min_group_size",2)
    body=(await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert body["cohort"]["values"]["patients"]==3
    assert body["journey"]["suppressed"] and body["journey"]["values"] is None
    assert body["barriers"]["suppressed"] and body["distributions"]==[]
    assert body["distributions_suppressed"]
    # With N=3, a group of two also hides its one-person complement.
    ids=(await client.post(f'/surveys/{survey["id"]}/assign',headers=headers("doctor"),json={"patient_ids":[3],"client_request_id":str(uuid4())})).json()["assignment_ids"]
    await client.post(f'/survey-assignments/{ids[0]}/submit',headers=headers("patient3"),json={"answers":ANSWERS})
    body=(await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert all(item["values"] is None for item in body["dimensions"])
