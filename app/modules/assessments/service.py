import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select
from fastapi import HTTPException

from app.modules.assessments.models import OutboxEvent, QuestionnaireResponse
from app.modules.audit.service import record_event

logger = logging.getLogger("app.assessments")


@dataclass(frozen=True, slots=True)
class QuestionnaireSpec:
    length: int
    risk_threshold: int
    risk_flag: str


SPECS: dict[str, QuestionnaireSpec] = {
    "phq9": QuestionnaireSpec(length=9, risk_threshold=10, risk_flag="depression_risk"),
    "gad7": QuestionnaireSpec(length=7, risk_threshold=10, risk_flag="anxiety_risk"),
}


@dataclass(frozen=True, slots=True)
class ScoreResult:
    score: int
    risk_flags: list[str]


def score_answers(form_type: str, answers: list[int]) -> ScoreResult:
    if form_type not in SPECS or len(answers) != SPECS[form_type].length or any(type(a) is not int or not 0 <= a <= 3 for a in answers):
        raise ValueError("Invalid questionnaire answers")
    spec = SPECS[form_type]
    score = sum(answers)
    flags: list[str] = []
    if score >= spec.risk_threshold:
        flags.append(spec.risk_flag)
    if form_type == "phq9" and answers[8] > 0:
        flags.append("phq9_item9_positive")
    return ScoreResult(score=score, risk_flags=flags)


async def save_response(
    session: AsyncSession,
    patient_id: int,
    form_type: str,
    form_version: str,
    answers: list[int],
    client_request_id: str | None = None,
    actor_id: int | None = None,
) -> QuestionnaireResponse:
    result = score_answers(form_type, answers)
    values = dict(
        patient_id=patient_id,
        form_type=form_type,
        form_version=form_version,
        answers=answers,
        score=result.score,
        risk_flags=result.risk_flags,
        client_request_id=client_request_id,
    )
    response = (await session.execute(insert(QuestionnaireResponse).values(**values)
        .on_conflict_do_nothing(constraint="uq_assessment_request").returning(QuestionnaireResponse))).scalar_one_or_none()
    if response is None:
        response = await session.scalar(select(QuestionnaireResponse).where(QuestionnaireResponse.patient_id == patient_id,
                                            QuestionnaireResponse.client_request_id == client_request_id))
        if response.form_type != form_type or response.form_version != form_version or response.answers != answers:
            raise HTTPException(409, "Ключ запроса уже использован с другими ответами")
        return response
    if result.risk_flags:
        event = OutboxEvent(
            event_type="assessment.risk_detected",
            payload={
                "patient_id": patient_id,
                "assessment_id": response.id,
                "form_type": form_type,
                "form_version": form_version,
                "score": result.score,
                "risk_flags": result.risk_flags,
            },
        )
        session.add(event)
    await session.flush()
    record_event(session, actor_id, patient_id, "assessment.completed", "assessment", response.id)
    logger.info("saved assessment id=%s", response.id)
    return response
