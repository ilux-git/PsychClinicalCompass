from datetime import datetime, timedelta, timezone

from app.core.security import create_access_token
from app.modules.access.models import User, UserRole


async def create_task(client, auth, title, *, stage="open", verification=None, **fields):
    response = await client.post("/patients/1/tasks", headers=auth, json={"title": title, **fields})
    assert response.status_code == 201
    task = response.json()
    if stage != "open":
        response = await client.patch(f"/tasks/{task['id']}", headers=auth,
            json={"status": stage, "action_result": "Синтетическое действие", "expected_revision": task["revision"]})
        assert response.status_code == 200
        task = response.json()
    if verification:
        response = await client.post(f"/tasks/{task['id']}/verify", headers=auth,
            json={"status": verification, "comment": "Основание синтетической проверки", "expected_revision": task["revision"]})
        assert response.status_code == 200
        task = response.json()
    return task


async def test_worklist_active_combines_unfinished_stages_and_preserves_legacy_default(client, headers):
    auth = headers("doctor")
    opened = await create_task(client, auth, "Назначено")
    started = await create_task(client, auth, "В работе", stage="in_progress")
    await create_task(client, auth, "Выполнено", stage="done")
    response = await client.get("/coordination/board", headers=auth, params={"stage": "all", "focus": "active"})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2 and {row["id"] for row in data["items"]} == {opened["id"], started["id"]}
    assert data["stage"] == "all" and data["focus"] == "active" and data["as_of"]
    legacy = (await client.get("/coordination/board", headers=auth)).json()
    assert legacy["stage"] == "open" and legacy["total"] == 1 and legacy["items"][0]["id"] == opened["id"]


async def test_worklist_awaiting_check_excludes_unfinished_actions_and_checked_includes_unknown(client, headers):
    auth = headers("doctor")
    await create_task(client, auth, "Ещё не выполнено")
    awaiting = await create_task(client, auth, "Ждёт проверки", stage="done")
    checked = [await create_task(client, auth, value, stage="done", verification=value)
               for value in ("resolved", "not_resolved", "unknown")]
    waiting = (await client.get("/coordination/board", headers=auth,
        params={"stage": "all", "focus": "awaiting_check"})).json()
    reviewed = (await client.get("/coordination/board", headers=auth,
        params={"stage": "all", "focus": "checked"})).json()
    assert waiting["total"] == 1 and [row["id"] for row in waiting["items"]] == [awaiting["id"]]
    assert reviewed["total"] == 3 and {row["id"] for row in reviewed["items"]} == {row["id"] for row in checked}
    intersection = (await client.get("/coordination/board", headers=auth,
        params={"stage": "open", "focus": "awaiting_check"})).json()
    assert intersection["total"] == 0 and intersection["items"] == []


async def test_worklist_overdue_requires_known_past_deadline_and_filters_before_pagination(client, headers):
    auth = headers("doctor")
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    first = await create_task(client, auth, "100% договориться", due_at=past)
    second = await create_task(client, auth, "50% уточнить", stage="in_progress", due_at=past)
    await create_task(client, auth, "Будущее 100%", due_at=future)
    await create_task(client, auth, "Нет срока 100%")
    await create_task(client, auth, "Готово 100%", stage="done", due_at=past)
    query = {"stage": "all", "focus": "overdue", "q": "%", "limit": 1}
    page = (await client.get("/coordination/board", headers=auth, params=query)).json()
    assert page["total"] == 2 and len(page["items"]) == 1 and page["next_cursor"]
    next_page = (await client.get("/coordination/board", headers=auth,
        params={**query, "before": page["next_cursor"]})).json()
    assert next_page["total"] == 2 and len(next_page["items"]) == 1 and next_page["next_cursor"] is None
    assert {row["id"] for row in page["items"] + next_page["items"]} == {first["id"], second["id"]}


async def test_worklist_keeps_coordinator_assignment_scope_and_private_projection(client, headers, database):
    async with database() as session:
        own = User(username="worklist-coordinator-a", display_name="Координатор А", role=UserRole.coordinator, hashed_password="unused")
        other = User(username="worklist-coordinator-b", display_name="Координатор Б", role=UserRole.coordinator, hashed_password="unused")
        session.add_all([own, other])
        await session.commit()
        own_id, other_id = own.id, other.id
    auth = headers("doctor")
    own_task = await create_task(client, auth, "Уточнить время", kind="organization", assigned_to_id=own_id, stage="done")
    await create_task(client, auth, "Другое поручение", kind="organization", assigned_to_id=other_id, stage="done")
    await create_task(client, auth, "Клиническая задача", stage="done")
    own_auth = {"Authorization": "Bearer " + create_access_token(own_id, "coordinator")}
    data = (await client.get("/coordination/board", headers=own_auth,
        params={"stage": "all", "focus": "awaiting_check"})).json()
    assert data["total"] == 1 and [row["id"] for row in data["items"]] == [own_task["id"]]
    for row in data["items"]:
        assert not {"source_type", "source_id", "verification_comment", "verified_by_id", "verified_at"} & row.keys()
    assert (await client.get("/coordination/board", headers=own_auth,
        params={"stage": "all", "focus": "awaiting_check", "patient_id": 2})).json()["total"] == 0


async def test_worklist_rejects_unknown_filter_and_never_grants_clinical_access(client, headers):
    await create_task(client, headers("doctor"), "Действие врача")
    params = {"stage": "all", "focus": "active"}
    assert (await client.get("/coordination/board", params=params)).status_code == 401
    for role in ("admin", "patient1", "patient2"):
        assert (await client.get("/coordination/board", params=params, headers=headers(role))).status_code == 403
    other = (await client.get("/coordination/board", params=params, headers=headers("doctor2"))).json()
    assert other["total"] == 0 and other["items"] == []
    assert (await client.get("/coordination/board", headers=headers("doctor"),
        params={"stage": "all", "focus": "unknown-filter"})).status_code == 422
