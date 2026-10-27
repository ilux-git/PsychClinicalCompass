from collections import Counter
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission
from app.modules.analytics.collection import dimension_coverage, generated_submission_ids, survey_journey


async def engagement(session: AsyncSession, user: User,
                     since: datetime | None = None, until: datetime | None = None) -> dict:
    if any(t is not None and t.tzinfo is None for t in (since, until)) or (since and until and since >= until):
        raise HTTPException(422, "Укажите корректный период с часовым поясом; верхняя граница не включается")
    patients = (await session.scalars(select(Patient).where(Patient.doctor_id == user.id).order_by(Patient.id))).all()
    patient_ids = [p.id for p in patients]
    query = select(SurveyAssignment, SurveySubmission).join(Survey, Survey.id == SurveyAssignment.survey_id).outerjoin(
        SurveySubmission, SurveySubmission.assignment_id == SurveyAssignment.id).where(SurveyAssignment.patient_id.in_(patient_ids))
    if since:
        query = query.where(SurveyAssignment.created_at >= since)
    if until:
        query = query.where(SurveyAssignment.created_at < until)
    assignments = (await session.execute(query)).all()
    # A published definition is immutable and may be shared by many assignments.
    # Decode it once per survey, keeping the original scoped assignment/response rows.
    survey_ids = {assignment.survey_id for assignment, _ in assignments}
    surveys = {survey.id: survey for survey in (await session.scalars(
        select(Survey).where(Survey.id.in_(survey_ids)))).all()} if survey_ids else {}
    rows = [(assignment, surveys[assignment.survey_id], response) for assignment, response in assignments]
    generated_ids = await generated_submission_ids(session, rows)
    report_query = select(AdherenceReport).where(AdherenceReport.patient_id.in_(patient_ids))
    if since:
        report_query = report_query.where(AdherenceReport.created_at >= since)
    if until:
        report_query = report_query.where(AdherenceReport.created_at < until)
    reports = (await session.scalars(report_query.order_by(AdherenceReport.created_at.desc()))).all()
    now = datetime.now(timezone.utc)
    submitted_patients = {a.patient_id for a, _, r in rows if r}
    assigned_patients = {a.patient_id for a, _, _ in rows}
    completed = sum(r is not None for _, _, r in rows)
    breakdown: dict[tuple[int, str], dict] = {}
    quotes: list[dict] = []
    for assignment, survey, submission in rows:
        if submission is None:
            continue
        for question in survey.questions:
            answer = submission.answers.get(question["id"])
            if answer is None:
                continue
            key = (survey.id, question["id"])
            item = breakdown.get(key)
            if item is None:
                item = {"survey_id": survey.id, "survey_title": survey.title, "version": survey.version,
                    "purpose": survey.purpose, "question_id": question["id"], "prompt": question["prompt"], "kind": question["kind"],
                    "dimension": question.get("dimension"),
                    "respondents": 0, "counts": Counter(), "options": {o["id"]: o["label"] for o in question["options"]}}
                breakdown[key] = item
            item["respondents"] += 1
            if question["kind"] in {"single", "multiple"}:
                item["counts"].update(answer if isinstance(answer, list) else [answer])
            elif question["kind"] == "scale":
                item["counts"].update([str(answer)])
            else:
                quotes.append({"patient_id": assignment.patient_id, "survey_title": survey.title,
                               "assignment_id": assignment.id, "submission_id": submission.id, "question_id": question["id"],
                               "prompt": question["prompt"], "text": answer, "created_at": submission.created_at,
                               "source": "patient_self_report"})
    charts = []
    for item in breakdown.values():
        counts = item.pop("counts")
        labels = item.pop("options")
        item["options"] = [{"id": key, "label": label, "count": counts.get(key, 0)} for key, label in labels.items()] if labels else [
            {"id": key, "label": key, "count": count} for key, count in sorted(counts.items())]
        charts.append(item)
    names = {p.id: p.full_name for p in patients}
    assigned_counts = Counter(a.patient_id for a,_,_ in rows)
    completed_counts = Counter(a.patient_id for a,_,r in rows if r is not None)
    return {
        "period": {"since": since, "until_exclusive": until, "cohort": "assignments_created_in_period"},
        "patients_total": len(patients), "assigned": len(rows), "completed": completed, "pending": len(rows) - completed,
        "completion_rate": round(100 * completed / len(rows), 1) if rows else None,
        "patients_with_feedback": len(submitted_patients), "patients_without_feedback": len(patient_ids) - len(submitted_patients),
        "patients_without_assignments": len(patient_ids) - len(assigned_patients),
        "overdue_assignments": sum(r is None and a.due_at is not None and a.due_at < now for a, _, r in rows),
        "questions": charts,
        "collection": {"dimensions": dimension_coverage(rows, patient_ids), "journey": survey_journey(rows, generated_ids=generated_ids)},
        "quotes": [{**q, "patient_name": names[q["patient_id"]]} for q in sorted(quotes, key=lambda x: x["created_at"], reverse=True)[:20]],
        "adherence": {"reports": len(reports), "statuses": dict(Counter(r.status for r in reports)),
            "patients_without_reports": len(patient_ids) - len({r.patient_id for r in reports}),
            "reasons": [{"id": r.id, "patient_id": r.patient_id, "patient_name": names[r.patient_id],
                "status": r.status, "recommendation": r.recommendation, "text": r.reason,
                "created_at": r.created_at, "source": "patient_self_report"} for r in reports if r.reason][:20]},
        "patients": [{"id": p.id, "full_name": p.full_name,
                       "assigned": assigned_counts[p.id],
                       "completed": completed_counts[p.id],
                       "observation_status": "has_feedback" if p.id in submitted_patients else "unknown"} for p in patients],
        "interpretation": "Ответы и самоотчёты пациентов. Неответ означает отсутствие данных; причины фактического ухода не установлены автоматически.",
        "churn_status": "definition_pending", "source": "Compass: questionnaires and patient self-reports"}


async def participation(session: AsyncSession, user: User) -> dict:
    patient = await session.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    rows = (await session.execute(select(SurveyAssignment, Survey, SurveySubmission).join(Survey,
        Survey.id == SurveyAssignment.survey_id).outerjoin(SurveySubmission,
        SurveySubmission.assignment_id == SurveyAssignment.id).where(SurveyAssignment.patient_id == patient.id))).all()
    history = [{"assignment_id": a.id, "title": s.title, "completed_at": r.created_at} for a, s, r in rows if r]
    history.sort(key=lambda item: item["completed_at"], reverse=True)
    return {"assigned": len(rows), "completed": len(history), "pending": len(rows) - len(history),
            "progress_percent": round(100 * len(history) / len(rows)) if rows else None,
            "history": history, "commercial_rewards_enabled": False,
            "message": "Каждый ответ помогает врачу лучше понять, какая поддержка вам нужна. Здесь нет правильных и неправильных ответов."}
