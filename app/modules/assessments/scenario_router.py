from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import CompassSession, CurrentUser, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.assessments.clinical_models import ScenarioEpisode
from app.modules.assessments.scenarios import scenario_catalog, scenario_for_mis
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.patients.models import PatientMapping

router=APIRouter(tags=["clinical-scenarios"])


@router.get("/patients/{patient_id}/scenario-measurements")
async def scenario_measurements(patient_id:int,session:CompassSession,user:CurrentUser):
    patient=await patient_for_user(session,user,patient_id)
    mapping=await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id==patient.id))
    if mapping is None or mapping.mis_id!=patient.mis_id:
        raise HTTPException(409,"Сначала требуется корректное сопоставление пациента с МИС")
    case=scenario_for_mis(patient.mis_id)
    return {"case_key":case["key"] if case else None,"anchor_date":case["anchor_date"] if case else None,
        "measurements":case["measurements"] if case else [],"source":"supplied_case_history",
        "item_answers_available":False,"version_confirmed":False}


@router.get("/patients/{patient_id}/clinical-scenario")
async def clinical_scenario(patient_id:int,session:CompassSession,doctor:User=Depends(require_role([UserRole.doctor]))):
    patient=await patient_for_user(session,doctor,patient_id)
    mapping=await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id==patient.id))
    case=scenario_for_mis(patient.mis_id)
    if case is None:return {"scenario":None,"episodes":[]}
    if mapping is None or mapping.mis_id!=patient.mis_id:
        raise HTTPException(409,"Сначала требуется корректное сопоставление пациента с МИС")
    rows=(await session.execute(select(ScenarioEpisode,Alert,ClinicalDecision).outerjoin(
        Alert,Alert.scenario_episode_id==ScenarioEpisode.id).outerjoin(ClinicalDecision,ClinicalDecision.alert_id==Alert.id).where(
        ScenarioEpisode.patient_id==patient.id,ScenarioEpisode.case_key==case["key"]
    ).order_by(ScenarioEpisode.occurred_at,ScenarioEpisode.id))).all()
    return {"scenario":case,"source_sha256":scenario_catalog()["source_sha256"],
        "drug_source":scenario_catalog()["drug_source"],"episodes":[{
            "id":episode.id,"step_key":episode.step_key,"occurred_at":episode.occurred_at,"snapshot":episode.snapshot,
            "alert_id":alert.id if alert else None,"alert_status":alert.status if alert else None,
            "decision_status":decision.status if decision else None,
            "doctor_conclusion":decision.reason if decision and decision.status!="pending_review" else None,
        } for episode,alert,decision in rows],"mis_write_performed":False}
