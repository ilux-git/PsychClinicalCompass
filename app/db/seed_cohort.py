"""Add an idempotent synthetic analytics cohort without changing MIS or existing patients."""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import json
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.demo_data import CONTINUATION_QUESTIONS
from app.db.session import async_session_compass, dispose_engines
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport
from app.modules.adherence.schemas import AdherenceWrite
from app.modules.audit.service import record_event
from app.modules.audit.models import AuditEvent
from app.modules.care.models import TreatmentStatusChange
from app.modules.notes.models import DoctorTask
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission
from app.modules.surveys.schemas import SurveyWrite
from app.modules.surveys.service import validate_answers
import app.db.models

COHORT = "demo-cohort-v1"
SIZE = 200
FEMALE_FIRST = ("Алина", "Виктория", "Дарья", "Екатерина", "Ксения", "Марина", "Наталья", "Полина", "Светлана", "Юлия")
MALE_FIRST = ("Андрей", "Антон", "Артём", "Вадим", "Виктор", "Георгий", "Денис", "Константин", "Павел", "Роман")
SURNAMES = ("Власов", "Громов", "Демидов", "Ермаков", "Захаров", "Крылов", "Логинов", "Назаров", "Павлов", "Титов")
BARRIERS = (("cost", "schedule"), ("schedule",), ("family",), ("other",), ("none",), ("unknown",), ("declined",), ("cost",))
DETAILS = ("Сложно совместить расходы и рабочие смены.", "Нужно подобрать другое время.",
    "Мешают семейные обязанности.", "Хочу обсудить, как упростить план.", "Сейчас получается следовать плану.",
    "Пока затрудняюсь определить причину.", "Предпочитаю обсудить это лично.", "Хочу уточнить доступные варианты оплаты.")
REFUSAL_REASONS = {"financial": "Пациент сообщил, что расходы на наблюдение оказались выше ожидаемых.",
    "time": "Пациент сообщил, что часы приёма не совпадают с его расписанием.",
    "family": "Пациент сообщил, что продолжению наблюдения мешают семейные обстоятельства.",
    "other": "Пациент сообщил об отказе от дальнейшего наблюдения по другой причине.",
    "not_disclosed": "Пациент сообщил об отказе и предпочёл не уточнять причину."}
VERIFICATION_COMMENTS = {"resolved": "Пациент сообщил, что после согласованного изменения затруднение удалось устранить.",
    "not_resolved": "Пациент сообщил, что затруднение сохраняется; требуется повторный разбор.",
    "unknown": "Сведений пока недостаточно для оценки результата."}
QUESTIONS = [
    {"id": "readiness", "prompt": "Насколько вы готовы выполнять согласованный план до следующего приёма?",
     "kind": "scale", "dimension": "readiness", "minimum": 1, "maximum": 5},
    {"id": "trust", "prompt": "Насколько вам подходит предложенный подход?",
     "kind": "scale", "dimension": "approach_trust", "minimum": 1, "maximum": 5},
    {"id": "barriers", "prompt": "Что сейчас мешает выполнять согласованные рекомендации?",
     "kind": "multiple", "dimension": "constraints", "options": [
         {"id": key, "label": label, "analytics_category": category, "exclusive": exclusive}
         for key, label, category, exclusive in [
             ("cost", "Стоимость", "financial", False), ("schedule", "Время и расписание", "time", False),
             ("family", "Семейные обстоятельства", "family", False), ("other", "Другие обстоятельства", "other", False),
             ("none", "Сейчас ничего не мешает", "none", True), ("unknown", "Пока не могу уточнить", "unknown", True),
             ("declined", "Предпочитаю не отвечать", "declined", True)]]},
    {"id": "consistency", "prompt": "Насколько последовательно получается выполнять согласованные рекомендации?",
     "kind": "scale", "dimension": "recommendation_consistency", "minimum": 1, "maximum": 5},
    {"id": "details", "prompt": "Что важно обсудить с врачом?", "kind": "text", "required": False},
]


def request_key(value):
    return str(uuid5(NAMESPACE_URL, COHORT + "/" + value))


def patient_name(index):
    female = index < 100
    local = index % 100
    return (FEMALE_FIRST if female else MALE_FIRST)[local % 10] + " " + SURNAMES[local // 10] + ("а" if female else "")


def treatment_reason(status, category):
    return REFUSAL_REASONS[category] if status == "refused" else (
        "Врач зафиксировал завершение согласованного этапа наблюдения." if status == "completed" else
        "Наблюдение продолжается, следующий шаг согласован с врачом.")


async def seed_cohort(session, *, now=None):
    if get_settings().data_mode != "synthetic_demo":
        raise RuntimeError("Synthetic demonstration mode required")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("An aware import timestamp is required")
    await session.execute(text("SELECT pg_advisory_xact_lock(878027)"))
    doctors = {u.username: u for u in (await session.scalars(select(User).where(
        User.username.in_(("doctor", "doctor2")), User.role == UserRole.doctor))).all()}
    if set(doctors) != {"doctor", "doctor2"}:
        raise RuntimeError("Both demonstration doctors are required")
    coordinator = await session.scalar(select(User).where(User.username == "coordinator", User.role == UserRole.coordinator))
    usernames = [f"cohort_patient{i+1:03d}" for i in range(SIZE)]
    existing = {u.username: u for u in (await session.scalars(select(User).where(User.username.in_(usernames)))).all()}
    owned = set((await session.scalars(select(AuditEvent.object_id).where(
        AuditEvent.object_type == "user", AuditEvent.event_type == "demo_cohort.user_created"))).all())
    if any(u.role != UserRole.patient or u.id not in owned for u in existing.values()):
        raise RuntimeError("Cohort username conflicts with an existing unrelated account")
    linked = set((await session.scalars(select(Patient.user_id).where(Patient.user_id.in_([u.id for u in existing.values()])))).all()) if existing else set()
    if any(u.id not in linked for u in existing.values()):
        raise RuntimeError("Existing cohort identity has no patient; no partial repair performed")
    result = {"cohort": COHORT, "patients_created": 0, "patients_preserved": len(existing),
        "assignments_created": 0, "opened_created": 0, "submissions_created": 0, "tasks_created": 0,
        "mis_writes": 0, "retroactive_awards": 0}
    if len(existing) == SIZE:
        return result
    password_hash = hash_password("patient-pass-123")
    surveys = {}
    for doctor in doctors.values():
        for slot, (title, purpose, questions) in enumerate([
            ("План между приёмами", "barriers", QUESTIONS),
            ("Продолжение наблюдения", "continuation", CONTINUATION_QUESTIONS),
            ("Повторная оценка согласованного плана", "follow_up", QUESTIONS),
        ]):
            definition = SurveyWrite(title=title, purpose=purpose, questions=questions)
            normalized = definition.model_dump(mode="json")["questions"]
            survey = await session.scalar(select(Survey).where(Survey.doctor_id == doctor.id,
                Survey.title == title, Survey.version == 1, Survey.previous_version_id.is_(None)))
            if survey is None:
                survey = Survey(doctor_id=doctor.id, title=title, purpose=purpose, questions=normalized,
                    description="Обратная связь о согласованном плане и дальнейших шагах.", version=1,
                    created_at=now-timedelta(days=60), published_at=now-timedelta(days=59))
                session.add(survey)
                await session.flush()
                record_event(session, doctor.id, None, "demo_cohort.survey_created", "survey", survey.id, {"cohort": COHORT})
            elif survey.questions != normalized or not survey.published_at:
                raise RuntimeError("Cohort form conflicts with an existing edition")
            surveys[(doctor.id, slot)] = survey
    for index, username in enumerate(usernames):
        if username in existing:
            continue
        pair = index // 2
        doctor = doctors["doctor" if index % 2 == 0 else "doctor2"]
        name = patient_name(index)
        account = User(username=username, display_name=name, role=UserRole.patient,
            hashed_password=password_hash, created_at=now-timedelta(days=45))
        session.add(account)
        await session.flush()
        patient = Patient(full_name=name, user_id=account.id, doctor_id=doctor.id, mis_id=None,
            created_at=now-timedelta(days=45))
        session.add(patient)
        await session.flush()
        record_event(session, None, patient.id, "demo_cohort.user_created", "user", account.id, {"cohort": COHORT, "generated": True})
        result["patients_created"] += 1
        outcome = pair % 10
        if outcome:
            status = "refused" if outcome == 1 else "completed" if outcome in {2, 3} else "in_progress"
            category = ("financial", "time", "family", "other", "not_disclosed")[pair // 10 % 5] if status == "refused" else None
            session.add(TreatmentStatusChange(patient_id=patient.id, doctor_id=doctor.id,
                client_request_id=request_key(username + "/treatment"), status=status,
                reason=treatment_reason(status, category), reason_category=category,
                source="synthetic_doctor_fixture", created_at=now-timedelta(days=5)))
        initial = None
        for slot in range(3):
            eligible = index - 20
            if eligible < 0 or (slot == 2 and eligible >= 120):
                continue
            stage = (eligible + slot * 7) % 20
            created = now - timedelta(days=42-(pair*7+slot*5)%28, hours=index%12)
            opened = created + timedelta(hours=2+(pair+slot)%18) if stage >= 3 else None
            completed = ((created+timedelta(days=2, hours=3+pair%24)) if stage >= 16 else
                         opened+timedelta(minutes=2+pair%9)) if stage >= 6 else None
            survey = surveys[(doctor.id, slot)]
            assignment = SurveyAssignment(patient_id=patient.id, survey_id=survey.id,
                client_request_id=f"{COHORT}:{index}:{slot}", created_at=created,
                due_at=created+timedelta(days=2), first_opened_at=opened,
                status="completed" if completed else "assigned")
            session.add(assignment)
            await session.flush()
            result["assignments_created"] += 1
            result["opened_created"] += int(opened is not None)
            if completed is None:
                continue
            variant = pair % len(BARRIERS)
            answers = ({"intent": ("yes", "yes", "yes", "unsure", "no", "prefer_not")[pair%6],
                "clarity": 1+pair%5, "why": DETAILS[variant]} if slot == 1 else
                {"readiness": 1+(pair+slot)%5, "trust": 1+(pair//3+slot)%5,
                 "barriers": list(("none",) if slot == 2 and pair%3 == 0 else BARRIERS[variant]),
                 "consistency": 1+(pair//2+slot)%5, "details": DETAILS[variant]})
            submission = SurveySubmission(patient_id=patient.id, assignment_id=assignment.id,
                answers=validate_answers(survey, answers), created_at=completed)
            session.add(submission)
            await session.flush()
            result["submissions_created"] += 1
            record_event(session, account.id, patient.id, "survey.synthetic_imported", "survey_submission", submission.id,
                {"cohort": COHORT, "generated": True, "opening_is_simulated": True, "award_created": False})
            if slot == 0:
                initial = submission
        completed_ordinal = (index-20)//20*14 + (index-20)%20-6
        if initial is not None and completed_ordinal < 60:
            phase = completed_ordinal % 10
            done = phase >= 4
            verification = "resolved" if phase in {4, 5} else "not_resolved" if phase == 6 else "unknown" if phase == 7 else "pending"
            task = DoctorTask(patient_id=patient.id, doctor_id=doctor.id,
                client_request_id=request_key(username + "/task"), title="Уточнить барьер и согласовать следующий шаг",
                kind="organization", assigned_to_id=coordinator.id if coordinator and phase%2 == 0 else doctor.id,
                source_type="survey_submission", source_id=initial.id,
                status="done" if done else "in_progress" if phase >= 2 else "open",
                created_at=initial.created_at+timedelta(minutes=30), due_at=initial.created_at+timedelta(days=2),
                started_at=initial.created_at+timedelta(hours=2) if phase >= 2 else None,
                completed_at=initial.created_at+timedelta(days=1) if done else None,
                action_result="Обсудили затруднение и согласовали дальнейший шаг." if done else "",
                follow_up_at=initial.created_at+timedelta(days=3), verification_status=verification,
                verification_comment=VERIFICATION_COMMENTS[verification] if verification != "pending" else "",
                verified_at=initial.created_at+timedelta(days=4) if verification != "pending" else None,
                verified_by_id=doctor.id if verification != "pending" else None, revision=1)
            session.add(task)
            await session.flush()
            record_event(session, doctor.id, patient.id, "demo_cohort.task_imported", "doctor_task", task.id, {"cohort": COHORT, "generated": True})
            result["tasks_created"] += 1
        status = ("followed", "not_applicable", "not_followed", "unknown")[pair%4]
        report = AdherenceWrite(client_request_id=request_key(username + "/adherence"),
            recommendation="Согласованный план между приёмами", status=status,
            reason="На этом этапе рекомендация не относится к моей ситуации." if status == "not_applicable" else DETAILS[pair%len(DETAILS)])
        session.add(AdherenceReport(patient_id=patient.id, client_request_id=str(report.client_request_id),
            **report.model_dump(exclude={"client_request_id"}), created_at=now-timedelta(days=1+pair%7)))
    await session.flush()
    return result


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        async with async_session_compass.begin() as session:
            if not args.apply:
                existing = await session.scalar(select(func.count(User.id)).where(
                    User.username.in_([f"cohort_patient{i+1:03d}" for i in range(SIZE)])))
                print(json.dumps({"cohort": COHORT, "planned_patients": SIZE, "existing": existing, "writes": False}))
            else:
                print(json.dumps(await seed_cohort(session)))
    finally:
        await dispose_engines()


if __name__ == "__main__":
    asyncio.run(main())
