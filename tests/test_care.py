import asyncio
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import func, select

from app.core.security import create_access_token
from app.modules.access.models import User, UserRole
from app.modules.audit.models import AuditEvent
from app.modules.care.models import TreatmentStatusChange
from app.modules.integration.synthetic import PATH, patient_snapshot, snapshot
from app.modules.notes.models import DoctorTask


def test_synthetic_snapshot_is_versioned_and_cannot_be_mutated():
    digest = sha256(PATH.read_bytes()).hexdigest()
    assert snapshot().synthetic and len(snapshot().patients) == 10
    first = patient_snapshot(3)
    assert first["source"] == "synthetic_mis_json" and first["read_only"]
    assert first["data"]["demo_medication_report"]["status"] == "not_taken"
    first["data"]["medications"].clear()
    assert patient_snapshot(3)["data"]["medications"]
    assert patient_snapshot(None)["status"] == "not_linked"
    assert sha256(PATH.read_bytes()).hexdigest() == digest


async def test_doctor_authored_outcome_history_replay_and_stale_revision(client, headers, database):
    path = "/patients/1/treatment-status"
    assert (await client.get("/patients/1/care", headers=headers("doctor"))).json()["treatment"]["status"] == "unknown"
    data = {"client_request_id": str(uuid4()), "status": "in_progress", "reason": "Согласованный план", "expected_revision": 0}
    responses = await asyncio.gather(*[client.post(path, headers=headers("doctor"), json=data) for _ in range(3)])
    assert all(r.status_code == 201 for r in responses)
    revision = responses[0].json()["revision"]
    assert {r.json()["revision"] for r in responses} == {revision}
    assert (await client.post(path, headers=headers("doctor"), json={**data, "status": "refused"})).status_code == 409
    assert (await client.post(path, headers=headers("doctor"), json={**data, "client_request_id": str(uuid4())})).status_code == 409
    finished = {**data, "client_request_id": str(uuid4()), "status": "completed", "expected_revision": revision}
    assert (await client.post(path, headers=headers("doctor"), json=finished)).status_code == 201
    history = (await client.get("/patients/1/care", headers=headers("doctor"))).json()
    assert history["treatment"]["status"] == "completed" and len(history["history"]) == 2
    for name, code in [("patient1", 403), ("admin", 403), ("doctor2", 404)]:
        assert (await client.post(path, headers=headers(name), json=finished)).status_code == code
    async with database() as session:
        assert await session.scalar(select(func.count(TreatmentStatusChange.id))) == 2
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "treatment.status_changed")) == 2


async def test_delegated_task_is_operational_scoped_and_independently_verified(client, headers, database):
    async with database() as session:
        coord = User(username="coord", display_name="Координатор", role=UserRole.coordinator, hashed_password="unused")
        coord2 = User(username="coord2", display_name="Другой", role=UserRole.coordinator, hashed_password="unused")
        session.add_all([coord, coord2]); await session.commit()
        cid, cid2 = coord.id, coord2.id
    ch = {"Authorization": "Bearer " + create_access_token(cid, "coordinator")}
    ch2 = {"Authorization": "Bearer " + create_access_token(cid2, "coordinator")}
    msg = (await client.post("/conversations/1/messages", headers=headers("patient1"), json={"text": "Приватное основание"})).json()
    data = {"title": "Согласовать время", "kind": "organization", "assigned_to_id": cid,
            "client_request_id": str(uuid4()), "source_type": "message", "source_id": msg["id"]}
    created = await asyncio.gather(*[client.post("/patients/1/tasks", headers=headers("doctor"), json=data) for _ in range(2)])
    assert [r.status_code for r in created] == [201, 201]
    task_id = created[0].json()["id"]
    assert created[1].json()["id"] == task_id
    assert (await client.post("/patients/1/tasks", headers=headers("doctor"), json={**data, "title": "Другое"})).status_code == 409
    assert (await client.post("/patients/1/tasks", headers=headers("doctor"), json={**data, "client_request_id": str(uuid4()), "kind": "clinical"})).status_code == 422
    assert (await client.get("/patients/1", headers=ch)).status_code == 403
    assert (await client.get("/patients", headers=ch)).status_code == 403
    assert (await client.get("/patients/1/notes", headers=ch)).status_code == 403
    own = (await client.get("/coordination/tasks", headers=ch)).json()
    assert len(own) == 1 and "source_id" not in own[0] and "verification_comment" not in own[0]
    assert "Приватное основание" not in str(own)
    assert (await client.get("/coordination/tasks", headers=ch2)).json() == []
    assert (await client.patch(f"/tasks/{task_id}", headers=ch2, json={"status": "done"})).status_code == 404
    verify = {"status": "resolved", "comment": "Пациент подтвердил удобное время"}
    assert (await client.post(f"/tasks/{task_id}/verify", headers=headers("doctor"), json=verify)).status_code == 409
    assert (await client.patch(f"/tasks/{task_id}", headers=ch, json={"status": "done", "action_result": "Запись согласована"})).status_code == 200
    pending = (await client.get("/patients/1/tasks", headers=headers("doctor"))).json()[0]
    assert pending["status"] == "done" and pending["verification_status"] == "pending"
    assert (await client.post(f"/tasks/{task_id}/verify", headers=ch, json=verify)).status_code == 403
    assert (await client.post(f"/tasks/{task_id}/verify", headers=headers("doctor2"), json=verify)).status_code == 404
    verified = await client.post(f"/tasks/{task_id}/verify", headers=headers("doctor"), json=verify)
    assert verified.status_code == 200 and verified.json()["verification_status"] == "resolved"
    assert (await client.post(f"/tasks/{task_id}/verify", headers=headers("doctor"), json=verify)).status_code == 200
    assert (await client.patch(f"/tasks/{task_id}", headers=ch, json={"status": "open"})).status_code == 409
    assert "Пациент подтвердил" not in str((await client.get("/coordination/tasks", headers=ch)).json())
    async with database() as session:
        assert await session.scalar(select(func.count(DoctorTask.id))) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "task.result_verified")) == 1
