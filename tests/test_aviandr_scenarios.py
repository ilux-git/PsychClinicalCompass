from types import SimpleNamespace
from uuid import uuid4
from datetime import datetime,timezone

import pytest
from sqlalchemy import func, select

from app.core.security import create_access_token
from app.db.seed_aviandr import seed_scenarios
from app.modules.access.models import User
from app.modules.assessments.clinical_models import ScenarioEpisode
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.scenarios import scenario_catalog, scenario_for_mis, step_hypothesis
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.audit.models import AuditEvent
from app.modules.patients.models import Patient
from app.workers.outbox_worker import process_pending_events


def sources():
    return [SimpleNamespace(id=case["mis_id"],full_name=case["full_name"],diagnoses=case["diagnoses"])
            for case in scenario_catalog()["cases"]]


async def populate(database):
    async with database() as session,session.begin():
        return await seed_scenarios(session,sources(),apply=True)


def test_scenario_identities_and_hypotheses_do_not_invent_diagnoses():
    cases=scenario_catalog()["cases"]
    assert {case["mis_id"] for case in cases}=={8008,8009,8010}
    assert scenario_for_mis(8) is None
    renal=next(case for case in cases if case["source_id"]=="P010")
    proposal=step_hypothesis(renal,next(step for step in renal["steps"] if step["key"]=="renal_labs"))
    assert "60 мл/мин" in proposal["proposal"] and "не устанавливается" in proposal["proposal"]
    assert proposal["diagnosis_established"] is False and proposal["therapy_changed"] is False
    assert proposal["registry_current_verified"] is False
    copied=scenario_for_mis(8008);copied["diagnoses"].append("invented")
    assert "invented" not in scenario_for_mis(8008)["diagnoses"]


async def test_preview_and_repeated_seed_preserve_existing_patients_and_decisions(database,accounts):
    async with database() as session:
        original=[(p.id,p.full_name,p.doctor_id,p.user_id) for p in (await session.scalars(select(Patient))).all()]
        preview=await seed_scenarios(session,sources(),apply=False)
        assert preview["created_users"]==0 and preview["created_episodes"]==0
        assert await session.scalar(select(func.count()).select_from(ScenarioEpisode))==0
    first=await populate(database)
    assert (first["created_users"],first["created_patients"],first["created_episodes"])==(3,3,13)
    await process_pending_events()
    async with database() as session:
        alert=await session.scalar(select(Alert).where(Alert.source_kind=="clinical_scenario").order_by(Alert.id))
        decision=await session.scalar(select(ClinicalDecision).where(ClinicalDecision.alert_id==alert.id))
        decision.reason="Самостоятельный вывод врача";await session.commit()
        counts={model.__tablename__:await session.scalar(select(func.count()).select_from(model))
                for model in [User,Patient,ScenarioEpisode,Alert,ClinicalDecision,OutboxEvent,AuditEvent]}
    second=await populate(database)
    assert second["created_episodes"]==second["created_users"]==second["created_patients"]==0
    async with database() as session:
        assert {model.__tablename__:await session.scalar(select(func.count()).select_from(model))
                for model in [User,Patient,ScenarioEpisode,Alert,ClinicalDecision,OutboxEvent,AuditEvent]}==counts
        assert [(p.id,p.full_name,p.doctor_id,p.user_id) for p in (await session.scalars(select(Patient).where(Patient.id.in_([r[0] for r in original])).order_by(Patient.id))).all()]==original
        assert (await session.get(ClinicalDecision,decision.id)).reason=="Самостоятельный вывод врача"


async def test_mis_or_username_conflict_is_detected_before_any_profile_write(database,accounts):
    bad=sources();bad[1].full_name="Другой пациент"
    async with database() as session:
        with pytest.raises(ValueError,match="MIS profiles"):
            await seed_scenarios(session,bad,apply=True)
        assert await session.scalar(select(func.count()).select_from(ScenarioEpisode))==0
        assert await session.scalar(select(func.count()).select_from(Patient))==3


async def test_audit_failure_rolls_back_profiles_episodes_and_outbox(database,accounts,monkeypatch):
    from app.db import seed_aviandr
    original=seed_aviandr.record_event
    def fail(session,actor,patient,event,*args,**kwargs):
        if event=="scenario.episode_imported":raise RuntimeError("audit unavailable")
        original(session,actor,patient,event,*args,**kwargs)
    monkeypatch.setattr(seed_aviandr,"record_event",fail)
    with pytest.raises(RuntimeError,match="audit unavailable"):
        await populate(database)
    async with database() as session:
        assert await session.scalar(select(func.count()).select_from(Patient))==3
        assert await session.scalar(select(func.count()).select_from(ScenarioEpisode))==0
        assert await session.scalar(select(func.count()).select_from(OutboxEvent))==0


async def test_own_scenario_access_and_source_data_do_not_leak_to_other_roles(client,headers,database):
    report=await populate(database);await process_pending_events()
    profile=report["profiles"][0];patient_id=profile["patient_id"]
    async with database() as session:
        user=await session.scalar(select(User).where(User.username==profile["username"]))
    patient_headers={"Authorization":"Bearer "+create_access_token(user.id,"patient")}
    login=await client.post("/auth/login",json={"username":profile["username"],"password":"patient-pass-123"})
    assert login.status_code==200 and "P008" in login.json()["user"]["scenario_label"]
    result=await client.get(f"/patients/{patient_id}/clinical-scenario",headers=headers("doctor"))
    assert result.status_code==200 and len(result.json()["episodes"])==5
    assert result.json()["scenario"]["states"][0]["diagnosis_status"]=="recorded_by_physician"
    assert result.json()["mis_write_performed"] is False
    card=await client.get(f"/patients/{patient_id}",headers=headers("doctor"))
    assert card.status_code==200 and card.json()["mis"]["source"]=="synthetic_mis_json"
    assert card.json()["mis"]["diagnoses"]==["F53.0"]
    directory=(await client.get('/patients/directory',headers=headers('doctor'))).json()
    preview=next(row for row in directory['items'] if row['id']==patient_id)
    assert preview['latest_clinical_result'] is None
    assert preview['scenario_measurement']['score']==9 and preview['scenario_measurement']['version_confirmed'] is False
    assert (await client.get(f"/patients/{patient_id}/clinical-scenario",headers=headers("doctor2"))).status_code==404
    for role_headers in [headers("admin"),patient_headers]:
        assert (await client.get(f"/patients/{patient_id}/clinical-scenario",headers=role_headers)).status_code==403
    history=await client.get(f"/patients/{patient_id}/scenario-measurements",headers=patient_headers)
    assert history.status_code==200 and [row["score"] for row in history.json()["measurements"]]==[18,9]
    assert history.json()["version_confirmed"] is False and history.json()["item_answers_available"] is False
    assert (await client.get(f"/patients/{patient_id}/scenario-measurements",headers=headers("patient1"))).status_code==404


async def test_corrected_conclusion_is_separate_and_cannot_close_without_recorded_action(client,headers,database):
    report=await populate(database);await process_pending_events()
    patient_id=report["profiles"][1]["patient_id"]
    rows=(await client.get("/alerts",headers=headers("doctor"),params={"patient_id":patient_id})).json()
    row=next(item for item in rows if item["decision"]["facts"]["case_review"]["title"]=="Сообщение о добавлении пароксетина")
    decision=row["decision"];proposal=decision["facts"]["system_proposal"]
    assert "Возможно" in proposal and "не установлена" in proposal
    path=f'/clinical-decisions/{decision["id"]}/confirm'
    body={"action":"confirmed","expected_version":1,"reason":""}
    assert (await client.post(path,headers=headers("doctor"),json=body)).status_code==422
    body["reason"]="Уточнены препарат и время; сохраняются жалобы, запланирован очный осмотр."
    assert (await client.post(path,headers=headers("doctor2"),json=body)).status_code==404
    response=await client.post(path,headers=headers("doctor"),json=body)
    assert response.status_code==200 and response.json()["facts"]["system_proposal"]==proposal
    assert response.json()["reason"]==body["reason"] and response.json()["mis_write_performed"] is False
    assert (await client.post(path,headers=headers("doctor"),json=body)).json()["version"]==2
    assert (await client.post(f'/alerts/{row["id"]}/close',headers=headers("doctor"),json={})).status_code==409
    latest=(await client.get(f"/patients/{patient_id}/clinical-scenario",headers=headers("doctor"))).json()
    recorded=next(episode for episode in latest["episodes"] if episode["step_key"]=="self_medication")
    assert recorded["doctor_conclusion"]==body["reason"] and recorded["snapshot"]["hypothesis"]["proposal"]==proposal
    command=await client.post(f'/alerts/{row["id"]}/actions',headers=headers("doctor"),json={
        "client_request_id":str(uuid4()),"title":"Обсудить симптомы и уточнить приём препаратов","kind":"clinical"})
    assert command.status_code==201
    task_id=command.json()["task_id"]
    done=await client.patch(f"/tasks/{task_id}",headers=headers("doctor"),json={"status":"done","action_result":"Врач связался с пациентом и определил дальнейшие действия."})
    assert done.status_code==200 and done.json()["verification_status"]=="pending"
    assert (await client.post(f'/alerts/{row["id"]}/close',headers=headers("doctor"),json={})).json()["status"]=="closed"


async def test_scenario_urgency_routes_only_patient_ids_to_configured_coordinator(client,headers,database):
    from app.modules.access.models import UserRole
    from app.modules.alerts.escalation_models import DoctorEscalationRoute
    from tests.conftest import TEST_HASH
    async with database() as session:
        coordinator=User(username="case_coordinator",display_name="Координатор",role=UserRole.coordinator,hashed_password=TEST_HASH)
        session.add(coordinator);await session.flush()
        doctor=await session.scalar(select(User).where(User.username=="doctor"));doctor.availability="offline"
        session.add(DoctorEscalationRoute(doctor_id=doctor.id,coordinator_id=coordinator.id,updated_at=datetime.now(timezone.utc),revision=1))
        await session.commit()
    await populate(database);await process_pending_events()
    response=await client.get("/coordination/urgent-notices",headers={"Authorization":"Bearer "+create_access_token(coordinator.id,"coordinator")})
    assert response.status_code==200
    assert response.json()["items"]
    payload=response.text.lower()
    assert "пароксетин" not in payload and "авиандр" not in payload and "тошнота" not in payload


async def test_live_patient_message_creates_review_once_without_diagnosis_or_inferred_intake(client,headers,database):
    from app.modules.messaging.models import Message
    report=await populate(database)
    patient_id=report["profiles"][1]["patient_id"]
    login=(await client.post("/auth/login",json={"username":"patient_aviandr_interaction","password":"patient-pass-123"})).json()
    patient_headers={"Authorization":"Bearer "+login["access_token"]}
    body={"text":"Пароксетин я не принимаю. Можно обсудить его с врачом?","channel":"web","client_request_id":str(uuid4())}
    first=await client.post(f"/conversations/{patient_id}/messages",headers=patient_headers,json=body)
    repeat=await client.post(f"/conversations/{patient_id}/messages",headers=patient_headers,json=body)
    assert first.status_code==repeat.status_code==201 and first.json()["id"]==repeat.json()["id"]
    await process_pending_events();await process_pending_events()
    async with database() as session:
        episodes=(await session.scalars(select(ScenarioEpisode).where(ScenarioEpisode.message_id==first.json()["id"]))).all()
        assert len(episodes)==1 and episodes[0].snapshot["facts"][0].endswith(body["text"])
        episode=episodes[0];hypothesis=episode.snapshot["hypothesis"]
        assert hypothesis["diagnosis_established"] is False and hypothesis["therapy_changed"] is False
        assert hypothesis["severity"]=="review_required" and "не подтверждает приём" in hypothesis["proposal"]
        assert await session.scalar(select(func.count()).select_from(Alert).where(Alert.scenario_episode_id==episode.id))==1
        count=await session.scalar(select(func.count()).select_from(ScenarioEpisode))
    assert (await populate(database))["created_episodes"]==0
    # A doctor's quoted medication name is not a report from the patient.
    physician=await client.post(f"/conversations/{patient_id}/messages",headers=headers("doctor"),json={**body,"client_request_id":str(uuid4())})
    assert physician.status_code==201
    async with database() as session:
        assert await session.scalar(select(func.count()).select_from(ScenarioEpisode))==count
        assert await session.scalar(select(func.count()).select_from(Message).where(Message.id==first.json()["id"]))==1


async def test_new_message_and_review_outbox_roll_back_together_on_audit_failure(database,accounts,monkeypatch):
    from app.modules.assessments import scenario_messages
    from app.modules.messaging.models import Message
    from app.modules.messaging.service import send_message
    report=await populate(database);patient_id=report["profiles"][1]["patient_id"]
    async with database() as session:
        account=await session.scalar(select(User).where(User.username=="patient_aviandr_interaction"))
        count=await session.scalar(select(func.count()).select_from(OutboxEvent))
    def fail(*args,**kwargs):raise RuntimeError("audit unavailable")
    monkeypatch.setattr(scenario_messages,"record_event",fail)
    request_id=str(uuid4())
    with pytest.raises(RuntimeError,match="audit unavailable"):
        async with database() as session,session.begin():
            await send_message(session,patient_id,account,"Вопрос о пароксетине","web",request_id)
    async with database() as session:
        assert await session.scalar(select(func.count()).select_from(Message).where(Message.client_request_id==request_id))==0
        assert await session.scalar(select(func.count()).select_from(ScenarioEpisode).where(ScenarioEpisode.message_id.is_not(None)))==0
        assert await session.scalar(select(func.count()).select_from(OutboxEvent))==count
