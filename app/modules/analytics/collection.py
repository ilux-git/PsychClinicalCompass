"""Descriptive collection metrics. No patient traits are inferred from response time."""
from statistics import median

from sqlalchemy import select

from app.modules.analytics.dimensions import DIMENSIONS
from app.modules.assessments.clinical_models import ClinicalResult


def seconds_between(start, end):
    return (end - start).total_seconds() if start is not None and end is not None and end >= start else None


def duration_summary(values):
    known = [value for value in values if value is not None]
    return {"known": len(known), "unknown": len(values) - len(known),
            "median_seconds": round(median(known), 3) if known else None}


async def generated_submission_ids(session, rows):
    ids = {response.id for _, survey, response in rows if response is not None and survey.clinical_key is not None}
    if not ids:
        return set()
    return set((await session.scalars(select(ClinicalResult.submission_id).where(
        ClinicalResult.submission_id.in_(ids),
        ClinicalResult.result.contains({"synthetic_provenance": {"generated": True}})))).all())


def survey_journey(rows, *, generated_ids=frozenset()):
    opened = [(a, s, r) for a, s, r in rows if a.first_opened_at is not None]
    completed = [(a, s, r) for a, s, r in rows if r is not None]
    completed_after_open = [(a, s, r) for a, s, r in opened if r is not None]
    timed = [(a, s, r) for a, s, r in completed if r.id not in generated_ids]
    return {
        "assigned": len(rows), "opened": len(opened), "completed": len(completed),
        "opened_not_completed": sum(r is None for _, _, r in opened),
        "not_opened_not_completed": sum(a.first_opened_at is None and r is None for a, _, r in rows),
        "completed_without_open_record": sum(a.first_opened_at is None for a, _, _ in completed),
        "completed_after_open": len(completed_after_open),
        "opening_rate_percent": round(100 * len(opened) / len(rows), 1) if rows else None,
        "completion_after_open_percent": round(100 * len(completed_after_open) / len(opened), 1) if opened else None,
        "timing_excluded_generated": len(completed) - len(timed), "timing_eligible_completed": len(timed),
        "assignment_to_completion": duration_summary([seconds_between(a.created_at, r.created_at) for a, _, r in timed]),
        "open_to_completion": duration_summary([seconds_between(a.first_opened_at, r.created_at) for a, _, r in timed]),
        "delivery_to_completion": {"known": 0, "unknown": len(timed), "median_seconds": None},
        "interpretation": "Назначение означает доступность в кабинете. Показ формы не равен чтению или согласию; интервалы включают перерывы, внешняя доставка не измерена.",
    }


def dimension_observations(rows):
    """Reuse immutable question metadata within this one request, never patient data across requests."""
    groups = {code: {"assigned": set(), "responded": set(), "versions": set(), "answers": 0}
              for code in DIMENSIONS}
    questions_by_survey = {}
    for assignment, survey, response in rows:
        if survey.id not in questions_by_survey:
            questions_by_survey[survey.id] = [(question["dimension"], question["id"])
                for question in survey.questions if question.get("dimension") in DIMENSIONS]
        for code, question_id in questions_by_survey[survey.id]:
            group = groups[code]
            group["assigned"].add(assignment.patient_id)
            group["versions"].add((survey.id, question_id))
            if response and question_id in response.answers:
                group["responded"].add(assignment.patient_id)
                group["answers"] += 1
    return groups


def dimension_coverage(rows, patient_ids, *, observations=None):
    result = []
    all_patients = set(patient_ids)
    groups = dimension_observations(rows) if observations is None else observations
    for code, label in DIMENSIONS.items():
        group = groups[code]
        assigned_patients, respondents, question_versions = group["assigned"], group["responded"], group["versions"]
        result.append({"code": code, "label": label, "question_versions": len(question_versions),
                       "assigned_patients": len(assigned_patients), "responding_patients": len(respondents),
                       "patients_without_answer": len(assigned_patients - respondents),
                       "patients_without_assignment": len(all_patients - assigned_patients),
                       "coverage_percent": round(100 * len(respondents) / len(assigned_patients), 1) if assigned_patients else None,
                       "answers": group["answers"], "inferred_score": None})
    return result
