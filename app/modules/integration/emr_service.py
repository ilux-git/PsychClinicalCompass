"""Synthetic EMR envelope; no MIS writes, medical inference or external delivery."""
from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from app.modules.integration.emr_models import EmrDemoDocument, EmrDemoReceipt
from app.modules.notes.models import DoctorTask
from app.modules.patients.models import PatientMapping
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission


def canonical_hash(content: dict) -> str:
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


async def task_content(session, patient, task_id, *, lock=False):
    mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == patient.id))
    if mapping is None or patient.mis_id is None or mapping.mis_id != patient.mis_id:
        raise HTTPException(409, "Сначала нужна согласованная привязка пациента к демо-МИС")
    query = select(DoctorTask).where(DoctorTask.id == task_id, DoctorTask.patient_id == patient.id)
    task = await session.scalar(query.with_for_update() if lock else query)
    if task is None:
        raise HTTPException(404, "Задача не найдена или недоступна")
    if task.source_type != "survey_submission" or task.source_id is None:
        raise HTTPException(422, "В первой демо-передаче доступна задача с исходным ответом на опрос")
    source = (await session.execute(select(SurveySubmission, Survey).join(
        SurveyAssignment, SurveyAssignment.id == SurveySubmission.assignment_id).join(
        Survey, Survey.id == SurveyAssignment.survey_id).where(SurveySubmission.id == task.source_id,
            SurveySubmission.patient_id == patient.id, SurveyAssignment.patient_id == patient.id))).first()
    if source is None:
        raise HTTPException(404, "Исходный ответ не найден у этого пациента")
    submission, survey = source
    content = {"schema_version":"limbus-emr-demo/1", "synthetic":True,
        "patient_reference":{"system":"synthetic-mis", "id":mapping.mis_id},
        "section":"follow_up_observation",
        "source":{"type":"survey_submission", "id":submission.id, "submitted_at":submission.created_at.isoformat(),
            "survey":{"id":survey.id, "version":survey.version, "title":survey.title, "questions":deepcopy(survey.questions)},
            "answers":deepcopy(submission.answers)},
        "care":{"task_id":task.id, "task_revision":task.revision, "title":task.title, "kind":task.kind,
            "status":task.status, "action_result":task.action_result, "completed_at":task.completed_at.isoformat() if task.completed_at else None,
            "verification":{"status":task.verification_status, "comment":task.verification_comment,
                "verified_at":task.verified_at.isoformat() if task.verified_at else None}},
        "signature":{"kind":"simulation", "legally_valid":False}}
    return task, content, canonical_hash(content)


async def document_read(session, document: EmrDemoDocument, *, is_current=True, replayed=False):
    receipt = await session.scalar(select(EmrDemoReceipt).where(EmrDemoReceipt.document_id == document.id))
    return {"id":document.id, "task_id":document.task_id, "task_revision":document.task_revision,
        "content_hash":document.content_hash, "content":document.content, "approved_by":document.doctor_id,
        "approved_at":document.approved_at, "status":"accepted_by_simulator" if receipt else "approved",
        "is_current":is_current, "replayed":replayed,
        "receipt":{"id":receipt.id, "accepted_at":receipt.accepted_at, "content_hash":receipt.content_hash,
            "receiver":"local_emr_simulator", "synthetic":True, "external_delivery":False} if receipt else None}


async def document_is_current(session, patient, document):
    try:
        _, _, fingerprint = await task_content(session, patient, document.task_id, lock=True)
    except HTTPException as error:
        if error.status_code in {404, 409, 422}:
            return False
        raise
    return document.content_hash == fingerprint


async def accept_by_simulator(session, document):
    # The caller holds the document row lock. Receipt and audit share its transaction.
    receipt = EmrDemoReceipt(document_id=document.id, content_hash=document.content_hash)
    session.add(receipt)
    await session.flush()
    return receipt
