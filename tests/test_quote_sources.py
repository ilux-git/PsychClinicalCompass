from uuid import uuid4

from sqlalchemy import func, select

from app.core.security import create_access_token
from app.modules.access.models import User, UserRole
from app.modules.audit.models import AuditEvent
from app.modules.patients.models import Patient


async def completed_text_survey(client, headers, doctor, patient_id):
    questions = [{"id": key, "prompt": "Одинаковая формулировка", "kind": "text"}
                 for key in ("first", "second")]
    created = await client.post("/surveys", headers=headers(doctor), json={
        "title": "Синтетический источник обратной связи", "questions": questions})
    assert created.status_code == 201
    survey_id = created.json()["id"]
    assert (await client.post(f"/surveys/{survey_id}/publish", headers=headers(doctor))).status_code == 200
    assigned = await client.post(f"/surveys/{survey_id}/assign", headers=headers(doctor), json={
        "patient_ids": [patient_id], "client_request_id": str(uuid4())})
    assert assigned.status_code == 201
    assignment_id = assigned.json()["assignment_ids"][0]
    answers = {"first": f"Пациент {patient_id}: первый ответ", "second": f"Пациент {patient_id}: второй ответ"}
    submitted = await client.post(f"/survey-assignments/{assignment_id}/submit", headers=headers(f"patient{patient_id}"),
                                  json={"answers": answers})
    assert submitted.status_code == 200
    return assignment_id, submitted.json()["id"], answers


async def test_quote_source_identifies_question_even_with_same_prompt_and_does_not_write(client, headers, database):
    assignment_id, submission_id, answers = await completed_text_survey(client, headers, "doctor", 1)
    source = next(row for row in (await client.get("/survey-assignments", headers=headers("doctor"))).json()
                  if row["id"] == assignment_id)
    async with database() as session:
        before = await session.scalar(select(func.count(AuditEvent.id)))
    original = None
    for _ in range(2):
        response = await client.get("/analytics/engagement", headers=headers("doctor"))
        assert response.status_code == 200
        quotes = response.json()["quotes"]
        assert len(quotes) == 2
        assert {(row["submission_id"], row["question_id"]) for row in quotes} == {
            (submission_id, "first"), (submission_id, "second")}
        for quote in quotes:
            assert quote["assignment_id"] == source["id"]
            assert quote["patient_id"] == source["patient_id"] == 1
            assert quote["submission_id"] == source["submission"]["id"]
            assert quote["text"] == source["submission"]["answers"][quote["question_id"]] == answers[quote["question_id"]]
            assert quote["prompt"] == next(q["prompt"] for q in source["survey"]["questions"] if q["id"] == quote["question_id"])
        assert original is None or quotes == original
        original = quotes
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id))) == before


async def test_quote_sources_follow_current_patient_ownership_and_clinical_roles(client, headers, database, accounts):
    await completed_text_survey(client, headers, "doctor", 1)
    await completed_text_survey(client, headers, "doctor", 3)
    await completed_text_survey(client, headers, "doctor2", 2)
    first = (await client.get("/analytics/engagement", headers=headers("doctor"))).json()["quotes"]
    assert {row["patient_id"] for row in first} == {1, 3}
    second = (await client.get("/analytics/engagement", headers=headers("doctor2"))).json()["quotes"]
    assert {row["patient_id"] for row in second} == {2}
    async with database() as session:
        patient = await session.get(Patient, 1)
        patient.doctor_id = accounts["doctor2"].id
        coordinator = User(username="quote-source-coordinator", display_name="Координатор", role=UserRole.coordinator,
                           hashed_password="unused")
        session.add(coordinator)
        await session.commit()
        coordinator_id = coordinator.id
    after = (await client.get("/analytics/engagement", headers=headers("doctor"))).json()["quotes"]
    assert {row["patient_id"] for row in after} == {3}
    assert {row["submission_id"] for row in after}.isdisjoint({row["submission_id"] for row in first if row["patient_id"] == 1})
    current = (await client.get("/analytics/engagement", headers=headers("doctor2"))).json()["quotes"]
    assert {row["patient_id"] for row in current} == {1, 2}
    assert (await client.get("/analytics/engagement")).status_code == 401
    for role in ("patient1", "patient2", "admin"):
        assert (await client.get("/analytics/engagement", headers=headers(role))).status_code == 403
    coordinator_headers = {"Authorization": "Bearer " + create_access_token(coordinator_id, "coordinator")}
    assert (await client.get("/analytics/engagement", headers=coordinator_headers)).status_code == 403
