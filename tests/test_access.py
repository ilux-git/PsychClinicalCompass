import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import engine_mis


async def test_login_and_bad_credentials(client):
    response = await client.post("/auth/login", json={"username": "doctor", "password": "test-pass-123"})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "doctor" and body["token_type"] == "bearer"
    assert "hashed_password" not in body["user"]
    assert (await client.post("/auth/login", json={"username": "doctor", "password": "wrong"})).status_code == 401
    assert (await client.post("/auth/login", json={"username": "absent", "password": "wrong"})).status_code == 401
    assert (await client.get("/patients")).status_code == 401


@pytest.mark.parametrize("path", ["/patients", "/surveys", "/analytics/engagement", "/alerts", "/survey-assignments",
                                  "/patients/1", "/patients/1/assessments", "/patients/1/notes", "/patients/1/tasks", "/conversations/1/messages"])
async def test_admin_has_no_clinical_access(client, headers, path):
    assert (await client.get(path, headers=headers("admin"))).status_code == 403


@pytest.mark.parametrize("path", ["/patients/2", "/patients/2/assessments", "/patients/2/adherence", "/patients/2/timeline",
                                  "/patients/2/notes", "/patients/2/tasks", "/conversations/2/messages",
                                  "/survey-assignments?patient_id=2", "/alerts?patient_id=2"])
async def test_doctor_cannot_read_foreign_patient(client, headers, path):
    assert (await client.get(path, headers=headers("doctor"))).status_code == 404


async def test_patient_scope_and_private_work(client, headers):
    listed = (await client.get("/patients", headers=headers("patient1"))).json()
    assert [p["id"] for p in listed] == [1]
    assert (await client.get("/patients/2", headers=headers("patient1"))).status_code == 404
    for path in ["/patients/1/notes", "/patients/1/tasks", "/patients/1/timeline", "/alerts", "/analytics/engagement", "/surveys"]:
        assert (await client.get(path, headers=headers("patient1"))).status_code == 403


async def test_assessment_history_preserves_answers_and_versions_for_own_patient(client, headers):
    payloads = [
        {"form_type": "phq9", "form_version": "demo_numeric_v1", "answers": [0, 1, 2, 1, 0, 1, 2, 1, 0]},
        {"form_type": "gad7", "form_version": "demo_numeric_v1", "answers": [1, 1, 0, 1, 1, 0, 1]},
        {"form_type": "phq9", "form_version": "another_version", "answers": [1] * 9},
    ]
    for payload in payloads:
        assert (await client.post('/assessments/responses', headers=headers('patient1'), json=payload)).status_code == 201
    for actor in ('doctor', 'patient1'):
        response = await client.get('/patients/1/assessments', headers=headers(actor))
        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == len(payloads)
        for row, expected in zip(rows, payloads):
            assert row['form_type'] == expected['form_type'] and row['form_version'] == expected['form_version']
            assert row['answers'] == expected['answers'] and row['score'] == sum(expected['answers'])
    for actor in ('doctor2', 'patient2'):
        assert (await client.get('/patients/1/assessments', headers=headers(actor))).status_code == 404


async def test_card_readonly_source_and_availability(client, headers):
    card = (await client.get("/patients/1", headers=headers("doctor"))).json()
    assert card["mis"]["status"] == "available" and card["mis"]["source"] == "MIS"
    assert card["full_name"] == card["mis"]["full_name"]
    assert (await client.patch("/doctors/me/availability", headers=headers("patient1"), json={"availability":"available"})).status_code == 403
    assert (await client.patch("/doctors/me/availability", headers=headers("doctor"), json={"availability":"offline"})).status_code == 200
    card = (await client.get("/patients/1", headers=headers("patient1"))).json()
    assert card["doctor"]["availability"] == "offline"


async def test_mis_database_role_cannot_write(database):
    async with engine_mis.connect() as connection:
        with pytest.raises(DBAPIError):
            await connection.execute(text("INSERT INTO patients(full_name) VALUES ('forbidden_test_write')"))
