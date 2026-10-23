"""Fixed all-clinic aggregates; never return arbitrary clinical/free-text fields."""
from collections import Counter, defaultdict

from sqlalchemy import select

from app.modules.adherence.models import AdherenceReport
from app.modules.analytics.collection import dimension_coverage, seconds_between, survey_journey
from app.modules.analytics.dimensions import BARRIER_CATEGORIES, DIMENSIONS
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission
from app.modules.analytics.care import workflow_metrics

SOURCES = [
    {"code": "surveys", "status": "available", "label": "Ответы на авторские опросы"},
    {"code": "survey_events", "status": "available", "label": "Назначение, показ формы и завершение"},
    {"code": "adherence", "status": "available", "label": "Самоотчёты о выполнении рекомендаций"},
    {"code": "doctor_observations", "status": "private_excluded", "label": "Наблюдения врача: приватны"},
    {"code": "chat_facts", "status": "private_excluded", "label": "Факты из чата: ручные наблюдения врача"},
    {"code": "diary", "status": "patient_controlled_excluded", "label": "Дневник: доступ выбирает пациент"},
    {"code": "visits", "status": "synthetic_json", "label": "Визиты: синтетический JSON МИС"},
    {"code": "medication_reminders", "status": "in_app_simulation", "label": "Личные расписания и самоотчёты; напоминания — симуляция"},
    {"code": "wearables", "status": "not_connected", "label": "Устройства: нет выбранного поставщика"},
    {"code": "apple_state_of_mind", "status": "not_connected", "label": "Apple Health: нет подключения"},
]


def protect(values, contributor_sets, population, minimum):
    # Guard positive cells and their complements; suppression covers a whole related bundle.
    small = len(population) < minimum or any(
        0 < len(group) < minimum or 0 < len(population - group) < minimum
        for group in contributor_sets
    )
    return {"suppressed": small, "reason": "small_group_or_complement" if small else None,
            "values": None if small else values}


async def clinic_summary(session, minimum: int | None):
    report = {"status": "ready" if minimum is not None else "privacy_not_configured",
              "privacy": {"min_group_size": minimum, "fixed_clinic_cohort": True, "individual_access": False,
                          "arbitrary_text_included": False, "private_observations_included": False},
              "cohort": None, "dimensions": [], "journey": None, "barriers": None,
              "distributions": [], "distributions_suppressed": False, "adherence": None, "sources": SOURCES, "workflow": None}
    if minimum is None:
        return report
    population = set((await session.scalars(select(Patient.id))).all())
    rows = (await session.execute(select(SurveyAssignment, Survey, SurveySubmission).join(
        Survey, Survey.id == SurveyAssignment.survey_id).outerjoin(
        SurveySubmission, SurveySubmission.assignment_id == SurveyAssignment.id))).all()
    report["cohort"] = protect({"patients": len(population)}, [population], population, minimum)
    for dimension in dimension_coverage(rows, population):
        code = dimension["code"]
        assigned, responded = set(), set()
        for assignment, survey, response in rows:
            for question in survey.questions:
                if question.get("dimension") == code:
                    assigned.add(assignment.patient_id)
                    if response and question["id"] in response.answers:
                        responded.add(assignment.patient_id)
        report["dimensions"].append({"code": code, "label": dimension["label"],
            **protect({key: value for key, value in dimension.items() if key not in {"code", "label", "inferred_score"}},
                      [assigned, responded, assigned - responded, population - assigned], population, minimum)})
    stages = defaultdict(set)
    for assignment, _, response in rows:
        patient = assignment.patient_id
        stages["assigned"].add(patient)
        if assignment.first_opened_at:
            stages["opened"].add(patient)
        if response:
            stages["completed"].add(patient)
            stage = "completed_after_open" if assignment.first_opened_at else "completed_without_open"
            stages[stage].add(patient)
            duration = seconds_between(assignment.first_opened_at, response.created_at)
            stages["duration_known" if duration is not None else "duration_unknown"].add(patient)
            assignment_duration = seconds_between(assignment.created_at, response.created_at)
            stages["assignment_duration_known" if assignment_duration is not None else "assignment_duration_unknown"].add(patient)
        elif assignment.first_opened_at:
            stages["opened_not_completed"].add(patient)
        else:
            stages["not_opened_not_completed"].add(patient)
    report["journey"] = protect(survey_journey(rows), list(stages.values()), population, minimum)

    categories, category_people, barrier_people = Counter(), defaultdict(set), set()
    question_groups = {}
    for assignment, survey, response in rows:
        if response is None:
            continue
        for position, question in enumerate(survey.questions, 1):
            answer = response.answers.get(question["id"])
            if answer is None or question.get("dimension") not in DIMENSIONS:
                continue
            key = (survey.id, position)
            item = question_groups.setdefault(key, {"reference": f"S{survey.id}/V{survey.version}/Q{position}",
                "dimension": question["dimension"], "kind": question["kind"], "people": set(),
                "counts": Counter(), "buckets": defaultdict(set)})
            item["people"].add(assignment.patient_id)
            if question["kind"] == "scale":
                item["counts"][str(answer)] += 1
                item["buckets"][str(answer)].add(assignment.patient_id)
            elif question["kind"] in {"single", "multiple"}:
                selected = answer if isinstance(answer, list) else [answer]
                for index, option in enumerate(question["options"], 1):
                    if option["id"] in selected:
                        # Ordinal labels only: custom option labels can themselves contain identifying text.
                        item["counts"][str(index)] += 1
                        item["buckets"][str(index)].add(assignment.patient_id)
                if question["dimension"] == "constraints":
                    selected_categories = {option.get("analytics_category") or "unclassified"
                                           for option in question["options"] if option["id"] in selected}
                    for category in selected_categories:
                        if category not in BARRIER_CATEGORIES:
                            category = "unclassified"
                        categories[category] += 1
                        category_people[category].add(assignment.patient_id)
                    barrier_people.add(assignment.patient_id)
    for item in question_groups.values():
        values = {"responding_patients": len(item["people"]), "options": [
            {"value": value, "count": count} for value, count in sorted(item["counts"].items())]}
        protected = protect(values, [item["people"], *item["buckets"].values()], population, minimum)
        if protected["suppressed"]:
            report["distributions_suppressed"] = True
            continue  # Do not disclose metadata for a rare question group either.
        report["distributions"].append({"reference": item["reference"], "dimension": item["dimension"], "kind": item["kind"], **protected})
    report["barriers"] = protect({"responding_patients": len(barrier_people), "categories": [
        {"code": code, "label": label, "count": categories.get(code, 0)} for code, label in BARRIER_CATEGORIES.items()]},
        [barrier_people, *category_people.values()], population, minimum)
    adherence = (await session.scalars(select(AdherenceReport))).all()
    status_people = defaultdict(set)
    statuses = Counter()
    for row in adherence:
        status = row.status if row.status in {"followed", "not_followed", "unknown", "not_applicable"} else "unclassified"
        status_people[status].add(row.patient_id)
        statuses[status] += 1
    report["adherence"] = protect({"reports": len(adherence), "statuses": dict(statuses)},
                                    list(status_people.values()), population, minimum)
    patients = (await session.scalars(select(Patient))).all()
    values, contributors = await workflow_metrics(session, patients)
    report["workflow"] = protect(values, contributors, population, minimum)
    return report
