# Clinical Compass

A modular monolith backend for a medical platform: patient questionnaires (PHQ-9/GAD-7), doctor-patient messaging with Telegram integration, and a reliable outbox-based event pipeline. FastAPI + SQLAlchemy 2.0 (async) + Pydantic v2 + PostgreSQL + Redis.

## Project Vision & Roadmap (for the team)

**Clinical Compass** is the backend core of a medical platform. Priorities: data integrity, strict role-based access control, reliable asynchronous event processing. The full product brief lives in `VISION.txt` — read it before proposing architecture changes.

**Module map** (each module = `router` / `schemas` / `models` / `service` layers inside `app/modules/<name>/`):

| # | Module | Status |
|---|---|---|
| 01 | access — users & access management | models + RBAC deps implemented |
| 02 | patients — patient management | models implemented |
| 03 | assessments — assessment engine (PHQ-9/GAD-7 + outbox) | implemented & verified |
| 04 | clinical — clinical decision engine | planned |
| 05 | adherence — treatment & adherence | planned |
| 06 | messaging — messaging hub (web + Telegram) | implemented & verified |
| 07 | notes — doctor notes & tasks | planned |
| 08 | alerts — alert & crisis engine | planned |
| 09 | availability — doctor availability | planned |
| 10 | analytics — analytics & reporting | planned |
| 11 | integration — MIS integration adapter | read-only models implemented |
| 12 | audit — audit & security | planned |

**Near-term backlog, in order:**

1. `POST /auth/login` — real login. Requires adding a `username` column to `User` (one migration), seed update, and a login router. Until then, obtain JWTs from `python -m app.db.seed`.
2. Skeletons (`router.py` with `not_implemented` placeholders) for modules 04, 05, 07–10, 12.
3. `POST /alerts/{id}/acknowledge` and `GET /patients/{id}/timeline` stubs per VISION.

**Known deviations from VISION (accepted, revisit if needed):**

- Background worker is a plain asyncio polling loop (ARQ is a declared dependency; Celery was rejected — sync workers fight the async stack).
- Routers are mounted directly in `app/main.py`; the `app/api/v1/api.py` aggregator from VISION is not built yet.
- MIS DB is a separate PostgreSQL instance (not just a schema), connected via a SELECT-only role — stronger isolation than the VISION minimum.

## Coding Standards

- Strict type hints and `async`/`await` everywhere.
- Every module follows the four-layer layout: `router` (API) / `schemas` (Pydantic) / `models` (SQLAlchemy) / `service` (business logic). Routers stay thin; services own the rules.
- All secrets and connection strings come from `.env` (see `.env.example`); never hardcode them.
- Where complex clinical logic, real Telegram integration, or ML models will eventually land, leave `# TODO: Implement business logic according to Tech Specs`.

## Team Workflow

- Branch convention: `agent/<task-name>` cut from `main`. Never commit directly to `main` — PRs only.
- Commit per completed unit of work with a descriptive message; include evidence (test output, screenshots) in the PR body.
- Dev credentials in `docker/db_mis/init.sql` and `docker-compose.yml` are throwaway local-dev only — never connect them to a real MIS.

## Architecture

```
app/
├── core/        # config (pydantic-settings), security (JWT, bcrypt)
├── db/          # async engines/sessions, declarative bases, seed
├── api/         # shared dependencies (auth, RBAC)
├── modules/     # vertical business modules
│   ├── access/        # User model
│   ├── patients/      # Patient, PatientMapping models
│   ├── integration/   # read-only MIS models
│   ├── assessments/   # questionnaire responses + scoring + outbox
│   └── messaging/     # conversations + Telegram webhook
└── workers/     # outbox polling worker
alembic/         # Compass DB migrations
docker/db_mis/   # MIS DB bootstrap SQL
```

**Dual database design:**

- **Compass DB** — read/write. Owned by this service. All application tables.
- **MIS DB** — read-only. An external clinical information system, simulated here by a second PostgreSQL instance. The app connects with the `mis_reader` role, which has SELECT-only grants (enforced by the database itself — writes are rejected at the SQL level, not just in code).

**Outbox pattern:** when a risky questionnaire is saved or a Telegram message is queued, the same database transaction writes both the business row and an `OutboxEvent`. A background worker polls pending events, "dispatches" them (simulated dispatch to Redis/Celery; Telegram send flips the message status to `sent`), and marks them processed. This guarantees no event is lost if the process crashes after the business write.

## System Requirements

- Docker
- Docker Compose

## Startup

```bash
cp .env.example .env          # then edit secrets if needed
docker compose up --build -d
docker compose exec app alembic upgrade head
```

- App + Swagger UI: http://localhost:8000/docs
- Health check: http://localhost:8000/health (reports both DB connections)
- Worker: the `worker` service polls the outbox every `OUTBOX_POLL_INTERVAL_SECONDS` (default 5s)

**First-boot initialization:** the MIS DB creates its schema and 10 synthetic patients automatically via `docker/db_mis/init.sql` on the first start (its volume persists afterwards). The Compass DB is initialized by Alembic migrations, run manually as shown above.

## Migrations

Compass DB only. Run inside the app container:

```bash
docker compose exec app alembic upgrade head      # apply all
docker compose exec app alembic revision --autogenerate -m "describe change"   # after adding models
docker compose exec app alembic downgrade -1      # rollback one step
```

MIS DB is never migrated — it is an external system; its schema is mapped read-only in `app/modules/integration/mis_models.py`.

## Endpoints

Full interactive docs at http://localhost:8000/docs.

| Method | Path | Who | Description |
|---|---|---|---|
| GET | `/health` | public | Liveness + both DB connectivity |
| POST | `/assessments/responses` | patient | Save PHQ-9/GAD-7 answers; scores them and writes a risk outbox event atomically when threshold is crossed |
| GET | `/conversations/{patient_id}/messages` | doctor (own patients) / patient (own record) | Conversation history |
| POST | `/conversations/{patient_id}/messages` | doctor / patient | Send a message; `channel` = `web`, `tg_doctor` (doctor), or `tg_patient` (patient). Telegram channels enqueue an outbox event and start in `queued` status |
| POST | `/integrations/telegram/webhook` | Telegram (secret header) | Inbound Telegram updates; requires `X-Telegram-Bot-Api-Secret-Token`; duplicates are ignored by `external_message_id` |

Auth: `Authorization: Bearer <JWT>`. Roles: `doctor`, `patient`, `admin`. Admin cannot send or read conversations (by design).

## Test Users (seed)

```bash
docker compose exec app python -m app.db.seed
```

Idempotent. Creates admin, doctor, patient users plus 10 synthetic patients (patient #1 is linked to the patient user). Passwords:

| User | Password |
|---|---|
| admin | `admin-pass-123` |
| doctor | `doctor-pass-123` |
| patient | `patient-pass-123` |

The script also prints ready-made JWTs (`TOKEN_ADMIN`, `TOKEN_DOCTOR`, `TOKEN_PATIENT`) for immediate testing, since there is no login endpoint yet — issue tokens directly with `create_access_token(user_id, role)` from `app.core.security`.

## Configuration

`.env` (see `.env.example`): both `*_DATABASE_URL` connection strings, `REDIS_URL`, `JWT_SECRET` (use ≥32 bytes in production), Telegram token/webhook secret, outbox poll interval.
