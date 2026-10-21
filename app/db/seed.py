"""Idempotent synthetic demo seed. Never writes to the MIS connection."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import async_session_compass, async_session_mis, dispose_engines
from app.db.demo_data import BARRIER_QUESTIONS, CONTINUATION_QUESTIONS
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport
from app.modules.assessments.service import save_response
from app.modules.integration.mis_models import MISPatient
from app.modules.messaging.models import Message
from app.modules.notes.models import DoctorNote, DoctorTask
from app.modules.patients.models import Patient, PatientMapping
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission
from app.workers.outbox_worker import process_pending_events
import app.db.models


def key(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, "clinical-compass-demo/" + name))


async def seed_demo() -> dict:
    async with async_session_mis() as session:
        sources = (await session.scalars(select(MISPatient).where(MISPatient.id.between(1, 10)).order_by(MISPatient.id))).all()
    if len(sources) != 10:
        raise RuntimeError("Seed requires the ten synthetic MIS fixtures")
    now = datetime.now(timezone.utc)
    async with async_session_compass() as session:
        async def user(username: str, role: UserRole, name: str) -> User:
            row = await session.scalar(select(User).where(User.username == username))
            if row is None:
                row = User(username=username, role=role, display_name=name,
                           availability="available" if role == UserRole.doctor else "offline",
                           hashed_password=hash_password(f"{role.value}-pass-123"))
                session.add(row)
                await session.flush()
            return row

        await user("admin", UserRole.admin, "Администратор демо")
        doctors = [await user("doctor", UserRole.doctor, "Анна Сергеевна"),
                   await user("doctor2", UserRole.doctor, "Михаил Андреевич")]
        patients: list[Patient] = []
        patient_users: list[User] = []
        for i, source in enumerate(sources):
            account = await user(f"patient{i + 1}", UserRole.patient, source.full_name)
            patient_users.append(account)
            patient = await session.scalar(select(Patient).where(Patient.mis_id == source.id))
            if patient is None:
                patient = Patient(mis_id=source.id, full_name=source.full_name, doctor_id=doctors[0 if i < 8 else 1].id, user_id=account.id)
                session.add(patient)
                await session.flush()
            else:
                patient.full_name = source.full_name
                existing_doctor = await session.get(User, patient.doctor_id)
                if existing_doctor and existing_doctor.username.startswith("legacy_"):
                    patient.doctor_id = doctors[0 if i < 8 else 1].id
                existing_account = await session.get(User, patient.user_id) if patient.user_id else None
                if existing_account is None or existing_account.username.startswith("legacy_"):
                    patient.user_id = account.id
            patients.append(patient)
            mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == patient.id))
            if mapping is None:
                session.add(PatientMapping(compass_patient_id=patient.id, mis_id=source.id))
            elif mapping.mis_id != source.id:
                raise RuntimeError("Existing patient mapping conflicts with demo MIS")

        surveys: dict[tuple[int, str], Survey] = {}
        for doctor in doctors:
            for title, purpose, questions in [
                ("Что мешает выполнять рекомендации?", "barriers", BARRIER_QUESTIONS),
                ("Как вам подходит сопровождение?", "continuation", CONTINUATION_QUESTIONS),
            ]:
                survey = await session.scalar(select(Survey).where(Survey.doctor_id == doctor.id, Survey.title == title,
                                                                  Survey.version == 1, Survey.previous_version_id.is_(None)))
                if survey is None:
                    survey = Survey(doctor_id=doctor.id, title=title, description="Синтетический пример обратной связи. Не диагностическая шкала.",
                                    purpose=purpose, questions=questions, version=1, published_at=now - timedelta(days=7))
                    session.add(survey)
                    await session.flush()
                surveys[(doctor.id, purpose)] = survey

        barriers = [(["cost", "schedule"], "После смены сложно приехать, а расходы оказались выше ожидаемых."),
                    (["unclear"], "Не до конца понимаю, что делать между приёмами."),
                    (["schedule"], "Часы приёма совпадают с работой."),
                    (["discomfort"], "Хочу обсудить с врачом неприятные ощущения."),
                    (["none"], "Пока всё получается, спасибо за обратную связь.")]
        intents = [("unsure", "Нужно согласовать более удобное время.", 3),
                   ("yes", "Мне важно понимать следующий шаг.", 4),
                   ("no", "Не подходит расписание.", 2), ("prefer_not", "", 4)]
        for i, patient in enumerate(patients):
            if i == 7:
                continue
            for purpose in ("barriers", "continuation"):
                survey = surveys[(patient.doctor_id, purpose)]
                assignment_key = key(f"assignment/{patient.mis_id}/{purpose}")
                assignment = await session.scalar(select(SurveyAssignment).where(SurveyAssignment.patient_id == patient.id,
                                                        SurveyAssignment.client_request_id == assignment_key))
                if assignment is None:
                    assignment = SurveyAssignment(survey_id=survey.id, patient_id=patient.id, client_request_id=assignment_key,
                                                  due_at=now + timedelta(days=2), created_at=now - timedelta(days=5))
                    session.add(assignment)
                    await session.flush()
                answers = None
                if purpose == "barriers" and i < len(barriers):
                    answers = {"barriers": barriers[i][0], "details": barriers[i][1]}
                elif purpose == "continuation" and i < len(intents):
                    answers = {"intent": intents[i][0], "clarity": intents[i][2]}
                    if intents[i][1]:
                        answers["why"] = intents[i][1]
                if answers and not await session.scalar(select(SurveySubmission.id).where(SurveySubmission.assignment_id == assignment.id)):
                    session.add(SurveySubmission(assignment_id=assignment.id, patient_id=patient.id, answers=answers,
                                                 created_at=now - timedelta(days=2, hours=i)))
                    assignment.status = "completed"
            if i != 8:
                for point in range(2):
                    answers = [1] * 9 if point == 0 else [0, 1, 1, 1, 1, 0, 1, 1, 0]
                    if i == 9 and point == 1:
                        answers = [1] * 9
                    response = await save_response(session, patient.id, "phq9", "demo_numeric_v1", answers,
                                                   key(f"scale/{patient.mis_id}/{point}"), patient_users[i].id)
                    if response.created_at >= now - timedelta(minutes=1):
                        response.created_at = now - timedelta(days=14 if point == 0 else 2)
            for n, text in enumerate(["Здравствуйте! Поделитесь, что сейчас мешает соблюдать согласованный план.",
                                       barriers[i][1] if i < len(barriers) else "Пока не успел(а) заполнить опрос."]):
                request_key = key(f"message/{patient.mis_id}/{n}")
                if not await session.scalar(select(Message.id).where(Message.client_request_id == request_key)):
                    session.add(Message(patient_id=patient.id, sender_id=patient.doctor_id if n == 0 else patient_users[i].id,
                                        sender_role="doctor" if n == 0 else "patient", text=text, status="sent", channel="web",
                                        client_request_id=request_key, created_at=now - timedelta(days=3, minutes=-n)))
            if i < 4:
                request_key = key(f"adherence/{patient.mis_id}")
                if not await session.scalar(select(AdherenceReport.id).where(AdherenceReport.client_request_id == request_key)):
                    session.add(AdherenceReport(patient_id=patient.id, client_request_id=request_key,
                        recommendation="Согласованный план между визитами", status="not_followed" if i < 3 else "unknown",
                        reason=barriers[i][1], created_at=now - timedelta(days=1, hours=i)))
        first = patients[0]
        if not await session.scalar(select(DoctorNote.id).where(DoctorNote.patient_id == first.id)):
            session.add(DoctorNote(patient_id=first.id, doctor_id=first.doctor_id,
                                  text="Уточнить удобное время и финансовые барьеры со слов пациента.", source_type="manual"))
            session.add(DoctorTask(patient_id=first.id, doctor_id=first.doctor_id, title="Обсудить барьеры на следующем контакте"))
        await session.commit()
    await process_pending_events()
    return {"patients": len(patients), "doctors": len(doctors), "synthetic": True}


async def main() -> None:
    try:
        result = await seed_demo()
        print(f"Synthetic demo ready: {result['patients']} patients, {result['doctors']} doctors. No tokens printed.")
    finally:
        await dispose_engines()


if __name__ == "__main__":
    asyncio.run(main())
