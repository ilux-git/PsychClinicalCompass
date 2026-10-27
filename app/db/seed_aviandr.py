"""Add the three supplied synthetic scenarios without replacing existing patients or decisions."""
import argparse
import asyncio
from datetime import datetime, timedelta
from uuid import NAMESPACE_URL, uuid5
from types import SimpleNamespace

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from app.core.security import hash_password
from app.db.session import async_session_compass, dispose_engines
from app.modules.access.models import User, UserRole
from app.modules.assessments.clinical_models import ScenarioEpisode
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.scenarios import scenario_catalog, step_hypothesis
from app.modules.audit.service import record_event
from app.modules.messaging.models import Message, MessageChannel, MessageStatus
from app.modules.patients.models import Patient, PatientMapping
import app.db.models


async def seed_scenarios(session, sources, *, apply=False):
    cases=scenario_catalog()["cases"]
    sources={source.id:source for source in sources}
    doctor=await session.scalar(select(User).where(User.username=="doctor",User.role==UserRole.doctor,User.is_active.is_(True)))
    if doctor is None:raise ValueError("The existing active doctor account is required")
    await session.execute(text("SELECT pg_advisory_xact_lock(8432127)"))
    existing={}
    # Check every identity and every episode before any mutation.
    for case in cases:
        source=sources.get(case["mis_id"])
        if source is None or source.full_name!=case["full_name"] or source.diagnoses!=case["diagnoses"]:
            raise ValueError("Scenario MIS profiles must match the supplied synthetic JSON fixture")
        account=await session.scalar(select(User).where(User.username==case["username"]))
        patient=await session.scalar(select(Patient).where(Patient.mis_id==case["mis_id"]))
        if account and (account.role!=UserRole.patient or account.display_name!=case["full_name"] or not account.is_active):
            raise ValueError("Existing scenario username conflicts; no account was overwritten")
        if patient and (not account or patient.user_id!=account.id or patient.doctor_id!=doctor.id or patient.full_name!=case["full_name"]):
            raise ValueError("Existing scenario patient conflicts; no patient was overwritten")
        if account and not patient:
            raise ValueError("Unmatched existing scenario account; manual inspection required")
        if patient:
            mapping=await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id==patient.id))
            if mapping is None or mapping.mis_id!=case["mis_id"]:raise ValueError("Existing scenario MIS mapping conflicts")
            rows=(await session.scalars(select(ScenarioEpisode).where(ScenarioEpisode.patient_id==patient.id))).all()
            steps={step["key"]:step for step in case["steps"]}
            for row in rows:
                if row.message_id is not None and row.case_key==case["key"]:
                    continue  # Live patient observations are not overwritten by source re-import.
                if row.case_key!=case["key"] or row.step_key not in steps:
                    raise ValueError("Existing scenario history conflicts")
                if row.snapshot!=episode_snapshot(case,steps[row.step_key]):
                    raise ValueError("Scenario source version changed; existing history was preserved")
        existing[case["key"]]=(account,patient)
    report={"profiles":[],"created_users":0,"created_patients":0,"created_episodes":0,"apply":apply}
    for case in cases:
        account,patient=existing[case["key"]]
        report["profiles"].append({"username":case["username"],"scenario":case["key"],"mis_id":case["mis_id"],"patient_id":patient.id if patient else None})
        if not apply:continue
        if account is None:
            account=User(username=case["username"],display_name=case["full_name"],role=UserRole.patient,
                hashed_password=hash_password("patient-pass-123"),availability="offline")
            session.add(account);await session.flush();report["created_users"]+=1
        if patient is None:
            patient=Patient(mis_id=case["mis_id"],full_name=case["full_name"],doctor_id=doctor.id,user_id=account.id)
            session.add(patient);await session.flush()
            session.add(PatientMapping(compass_patient_id=patient.id,mis_id=case["mis_id"]))
            record_event(session,doctor.id,patient.id,"scenario.profile_created","patient",patient.id,
                {"case_key":case["key"],"synthetic":True,"source_sha256":scenario_catalog()["source_sha256"]})
            report["created_patients"]+=1
        report["profiles"][-1]["patient_id"]=patient.id
        for step in case["steps"]:
            row=await session.scalar(select(ScenarioEpisode).where(ScenarioEpisode.patient_id==patient.id,
                ScenarioEpisode.case_key==case["key"],ScenarioEpisode.step_key==step["key"]))
            if row is not None:continue
            at=datetime.fromisoformat(case["anchor_date"].replace("Z","+00:00"))+timedelta(days=step["day"],minutes=step.get("minute_offset",0))
            snapshot=episode_snapshot(case,step)
            if step.get("message"):
                request_id=str(uuid5(NAMESPACE_URL,f'clinical-compass-case/{case["key"]}/{step["key"]}/message'))
                message=(await session.execute(insert(Message).values(patient_id=patient.id,sender_id=account.id,
                    sender_role="patient",text=step["message"],channel=MessageChannel.WEB,status=MessageStatus.SENT,
                    client_request_id=request_id,created_at=at).on_conflict_do_nothing(
                    constraint="uq_message_request").returning(Message))).scalar_one_or_none()
                if message is None:
                    message=await session.scalar(select(Message).where(Message.sender_id==account.id,Message.client_request_id==request_id))
                    if message.patient_id!=patient.id or message.text!=step["message"]:
                        raise ValueError("Imported scenario message conflicts; history preserved")
                else:
                    record_event(session,doctor.id,patient.id,"scenario.message_imported","message",message.id)
            row=ScenarioEpisode(patient_id=patient.id,case_key=case["key"],step_key=step["key"],snapshot=snapshot,occurred_at=at)
            session.add(row);await session.flush()
            if step["review_required"]:
                session.add(OutboxEvent(event_type="clinical.scenario_review_requested",payload={"patient_id":patient.id,"scenario_episode_id":row.id}))
            record_event(session,doctor.id,patient.id,"scenario.episode_imported","clinical_scenario_episode",row.id,
                {"case_key":case["key"],"step_key":step["key"],"synthetic":True,"source_sha256":scenario_catalog()["source_sha256"]})
            report["created_episodes"]+=1
    return report


def episode_snapshot(case,step):
    return {"source_case_id":case["source_id"],"case_key":case["key"],"title":step["title"],"day":step["day"],
        "facts":step["facts"],"hypothesis":step_hypothesis(case,step) if step["review_required"] else None,
        "source_file":scenario_catalog()["source_file"],"source_sha256":scenario_catalog()["source_sha256"],"synthetic":True}


async def main(apply):
    try:
        # The user-approved integration boundary is JSON; this seed never connects to MIS.
        sources=[SimpleNamespace(id=case["mis_id"],full_name=case["full_name"],diagnoses=case["diagnoses"])
                 for case in scenario_catalog()["cases"]]
        async with async_session_compass() as session,session.begin():
            report=await seed_scenarios(session,sources,apply=apply)
        import json
        print(json.dumps(report,ensure_ascii=False))
    finally:await dispose_engines()


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--apply",action="store_true")
    asyncio.run(main(parser.parse_args().apply))
