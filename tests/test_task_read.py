from sqlalchemy import func, select

from app.core.security import create_access_token
from app.modules.access.models import User, UserRole
from app.modules.audit.models import AuditEvent
from app.modules.patients.models import Patient


async def test_task_read_is_current_scoped_and_does_not_write(client, headers, database, accounts):
    task = (await client.post('/patients/1/tasks', headers=headers('doctor'), json={'title': 'Уточнить удобное время'})).json()
    path = f"/tasks/{task['id']}"
    assert (await client.get(path)).status_code == 401
    for role in ('admin', 'patient1', 'patient2'):
        assert (await client.get(path, headers=headers(role))).status_code == 403
    assert (await client.get(path, headers=headers('doctor2'))).status_code == 404
    changed = await client.patch(path, headers=headers('doctor'), json={
        'status': 'in_progress', 'action_result': 'Уточняем варианты', 'expected_revision': 0})
    assert changed.status_code == 200
    async with database() as session:
        before = await session.scalar(select(func.count(AuditEvent.id)))
    for _ in range(2):
        response = await client.get(path, headers=headers('doctor'))
        assert response.status_code == 200
        current = response.json()
        assert current['status'] == 'in_progress' and current['revision'] == 1
        assert current['action_result'] == 'Уточняем варианты'
        assert current['patient_name'] == 'Иван Петров' and current['assignee_name'] == 'doctor'
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id))) == before
        patient = await session.get(Patient, 1)
        patient.doctor_id = accounts['doctor2'].id
        await session.commit()
    assert (await client.get(path, headers=headers('doctor'))).status_code == 404
    assert (await client.get(path, headers=headers('doctor2'))).status_code == 200
    assert (await client.get('/tasks/99999999', headers=headers('doctor2'))).status_code == 404


async def test_task_read_coordinator_cannot_expand_scope_or_private_fields(client, headers, database):
    async with database() as session:
        assigned = User(username='task-reader-a', display_name='Назначенный координатор', role=UserRole.coordinator, hashed_password='unused')
        other = User(username='task-reader-b', display_name='Другой координатор', role=UserRole.coordinator, hashed_password='unused')
        session.add_all([assigned, other])
        await session.commit()
        assigned_id, other_id = assigned.id, other.id
    own_headers = {'Authorization': 'Bearer ' + create_access_token(assigned_id, 'coordinator')}
    other_headers = {'Authorization': 'Bearer ' + create_access_token(other_id, 'coordinator')}
    message = (await client.post('/conversations/1/messages', headers=headers('patient1'), json={'text': 'Приватный клинический источник'})).json()
    own = (await client.post('/patients/1/tasks', headers=headers('doctor'), json={
        'title': 'Согласовать время контакта', 'kind': 'organization', 'assigned_to_id': assigned_id,
        'source_type': 'message', 'source_id': message['id']})).json()
    clinical = (await client.post('/patients/1/tasks', headers=headers('doctor'), json={'title': 'Задача врачу'})).json()
    foreign = (await client.post('/patients/1/tasks', headers=headers('doctor'), json={
        'title': 'Другому координатору', 'kind': 'organization', 'assigned_to_id': other_id})).json()
    await client.patch(f"/tasks/{own['id']}", headers=own_headers, json={
        'status': 'done', 'action_result': 'Варианты времени переданы', 'expected_revision': 0})
    await client.post(f"/tasks/{own['id']}/verify", headers=headers('doctor'), json={
        'status': 'unknown', 'comment': 'Приватное основание врача', 'expected_revision': 1})
    response = await client.get(f"/tasks/{own['id']}", headers=own_headers)
    assert response.status_code == 200
    value = response.json()
    assert value['verification_status'] == 'unknown' and value['action_result'] == 'Варианты времени переданы'
    assert {'source_id', 'source_type', 'verification_comment', 'verified_at', 'verified_by_id'}.isdisjoint(value)
    assert 'Приватн' not in str(value)
    for task_id in (clinical['id'], foreign['id']):
        assert (await client.get(f'/tasks/{task_id}', headers=own_headers)).status_code == 404
    assert (await client.get(f"/tasks/{own['id']}", headers=other_headers)).status_code == 404
