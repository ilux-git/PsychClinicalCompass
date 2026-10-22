import asyncio
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

import asyncpg
import pytest
from sqlalchemy import func, select

from app.db.base import Base
from app.db.seed import seed_demo
from app.db.session import async_session_mis
from app.modules.integration.mis_models import MISPatient
from app.modules.patients.models import Patient, PatientMapping
from app.modules.assessments.models import QuestionnaireResponse


async def test_repeat_seed_preserves_counts_and_ten_mis_mappings(database):
    async def counts():
        async with database() as session:
            return {table.name: await session.scalar(select(func.count()).select_from(table))
                    for table in Base.metadata.sorted_tables}
    await seed_demo()
    first = await counts()
    await seed_demo()
    assert await counts() == first
    async with async_session_mis() as mis:
        source = {p.id:p.full_name for p in (await mis.scalars(select(MISPatient))).all()}
    async with database() as session:
        pairs = (await session.execute(select(Patient, PatientMapping).join(
            PatientMapping, PatientMapping.compass_patient_id == Patient.id))).all()
        assert len(pairs) == 10
        assert all(patient.mis_id == mapping.mis_id and patient.full_name == source[mapping.mis_id] for patient, mapping in pairs)
        responses = (await session.scalars(select(QuestionnaireResponse))).all()
        assert sum(r.form_type == 'phq9' for r in responses) == 16
        assert sum(r.form_type == 'gad7' for r in responses) == 13
        assert all(len(r.answers) == (9 if r.form_type == 'phq9' else 7) and r.score == sum(r.answers) for r in responses)
        by_mis = {patient.mis_id: [r for r in responses if r.patient_id == patient.id] for patient, _ in pairs}
        assert not by_mis[8] and not by_mis[9]
        assert len([r for r in by_mis[6] if r.form_type == 'gad7']) == 1
        changes = []
        for rows in by_mis.values():
            points = sorted([r for r in rows if r.form_type == 'gad7'], key=lambda r: (r.created_at, r.id))
            if len(points) == 2:
                changes.append(points[-1].score - points[0].score)
        assert min(changes) < 0 < max(changes) and 0 in changes


def test_migration_upgrade_backfill_and_roundtrip():
    url = os.getenv('MIGRATION_DATABASE_URL')
    if not url or os.getenv('ALLOW_TEST_DB_RESET') != '1':
        pytest.skip('Separate *_migration_test URL required for migration reset')
    assert urlsplit(url).path.rsplit('/',1)[-1].endswith('_migration_test')
    dsn = url.replace('postgresql+asyncpg://','postgresql://')
    async def sql(query):
        connection = await asyncpg.connect(dsn)
        try:
            if query.startswith('SELECT'):
                return await connection.fetch(query)
            await connection.execute(query)
            return []
        finally:
            await connection.close()
    # Only the explicitly opted-in, separately named migration-test database.
    asyncio.run(sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public'))
    env = {**os.environ, 'COMPASS_DATABASE_URL':url}
    def migrate(*args):
        result = subprocess.run([sys.executable,'-m','alembic',*args], cwd=Path(__file__).resolve().parent.parent,
                                env=env,capture_output=True,text=True,timeout=60)
        assert result.returncode == 0, result.stdout + result.stderr
    previous = '1f9990e14d6e'
    migrate('upgrade', previous)
    asyncio.run(sql("INSERT INTO users(role,hashed_password) VALUES ('doctor','legacy-hash-preserved')"))
    migrate('upgrade','head')
    rows = asyncio.run(sql('SELECT username, availability, hashed_password FROM users'))
    assert dict(rows[0]) == {'username':'legacy_doctor_1','availability':'offline','hashed_password':'legacy-hash-preserved'}
    migrate('check')
    migrate('downgrade', previous)
    assert asyncio.run(sql('SELECT hashed_password FROM users'))[0]['hashed_password'] == 'legacy-hash-preserved'
    migrate('upgrade','head')
    migrate('check')
