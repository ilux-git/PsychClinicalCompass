import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessments.models import OutboxEvent, QuestionnaireResponse

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
) -> QuestionnaireResponse:
    result = score_answers(form_type, answers)
    response = QuestionnaireResponse(
        patient_id=patient_id,
        form_type=form_type,
        form_version=form_version,
        answers=answers,
        score=result.score,
        risk_flags=result.risk_flags,
    )
    session.add(response)
    if result.risk_flags:
        event = OutboxEvent(
            event_type="assessment.risk_detected",
            payload={
                "patient_id": patient_id,
                "form_type": form_type,
                "form_version": form_version,
                "score": result.score,
                "risk_flags": result.risk_flags,
            },
        )
        session.add(event)
    await session.flush()
    logger.info(
        "saved assessment response id=%s patient=%s form=%s score=%s flags=%s outbox=%s",
        response.id,
        patient_id,
        form_type,
        result.score,
        result.risk_flags,
        bool(result.risk_flags),
    )
    return response
