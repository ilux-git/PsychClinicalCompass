"""Descriptive collection metrics. No patient traits are inferred from response time."""
from statistics import median

from app.modules.analytics.dimensions import DIMENSIONS


def seconds_between(start, end):
    return (end - start).total_seconds() if start is not None and end is not None and end >= start else None


def duration_summary(values):
    known = [value for value in values if value is not None]
    return {"known": len(known), "unknown": len(values) - len(known),
            "median_seconds": round(median(known), 3) if known else None}


def survey_journey(rows):
    opened = [(a, s, r) for a, s, r in rows if a.first_opened_at is not None]
    completed = [(a, s, r) for a, s, r in rows if r is not None]
    completed_after_open = [(a, s, r) for a, s, r in opened if r is not None]
    return {
        "assigned": len(rows), "opened": len(opened), "completed": len(completed),
        "opened_not_completed": sum(r is None for _, _, r in opened),
        "not_opened_not_completed": sum(a.first_opened_at is None and r is None for a, _, r in rows),
        "completed_without_open_record": sum(a.first_opened_at is None for a, _, _ in completed),
        "completed_after_open": len(completed_after_open),
        "opening_rate_percent": round(100 * len(opened) / len(rows), 1) if rows else None,
        "completion_after_open_percent": round(100 * len(completed_after_open) / len(opened), 1) if opened else None,
        "assignment_to_completion": duration_summary([seconds_between(a.created_at, r.created_at) for a, _, r in completed]),
        "open_to_completion": duration_summary([seconds_between(a.first_opened_at, r.created_at) for a, _, r in completed]),
        "delivery_to_completion": {"known": 0, "unknown": len(completed), "median_seconds": None},
        "interpretation": "Назначение означает доступность в кабинете. Показ формы не равен чтению или согласию; интервалы включают перерывы, внешняя доставка не измерена.",
    }


def dimension_coverage(rows, patient_ids):
    result = []
    all_patients = set(patient_ids)
    for code, label in DIMENSIONS.items():
        assigned_patients, respondents, question_versions = set(), set(), set()
        answer_count = 0
        for assignment, survey, response in rows:
            for question in survey.questions:
                if question.get("dimension") != code:
                    continue
                assigned_patients.add(assignment.patient_id)
                question_versions.add((survey.id, question["id"]))
                if response and question["id"] in response.answers:
                    respondents.add(assignment.patient_id)
                    answer_count += 1
        result.append({"code": code, "label": label, "question_versions": len(question_versions),
                       "assigned_patients": len(assigned_patients), "responding_patients": len(respondents),
                       "patients_without_answer": len(assigned_patients - respondents),
                       "patients_without_assignment": len(all_patients - assigned_patients),
                       "coverage_percent": round(100 * len(respondents) / len(assigned_patients), 1) if assigned_patients else None,
                       "answers": answer_count, "inferred_score": None})
    return result
