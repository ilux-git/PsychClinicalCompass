"""Demo effort-based participation points; no exchange, symptom weighting or ingestion claim."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, UniqueConstraint, func, select
from sqlalchemy.orm import Mapped, mapped_column

from app.api.deps import CompassSession, require_role
from app.db.base import Base
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient

POLICY_VERSION = "demo-effort-v1"
RULES = {
    "survey": {"label": "Опросы", "daily_cap": 30, "description": "1 балл за заполненный пункт, 2 за текстовый пункт авторской формы; до 30 в день"},
    "medication": {"label": "Ведение расписания лекарств", "daily_cap": 2, "description": "2 балла за ведение расписания или явную отметку; один раз в день независимо от числа лекарств и приёмов"},
    "diary": {"label": "Дневник состояния", "daily_cap": 3, "description": "3 балла за запись, один раз в день; личная и общая запись равноправны"},
}


class ParticipationAward(Base):
    __tablename__ = "participation_awards"
    __table_args__ = (
        UniqueConstraint("patient_id", "kind", "source_key", name="uq_participation_source"),
        CheckConstraint("points >= 0", name="ck_participation_nonnegative"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    source_key: Mapped[str] = mapped_column(String(120), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(40), nullable=False)
    points: Mapped[int] = mapped_column(nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


async def grant_points(session, patient_id, kind, source_key, actor_id, effort_units=1):
    # One lock also serializes different action types and concurrent source requests.
    await session.scalar(select(Patient).where(Patient.id == patient_id).with_for_update())
    previous = await session.scalar(select(ParticipationAward).where(ParticipationAward.patient_id == patient_id,
        ParticipationAward.kind == kind, ParticipationAward.source_key == source_key))
    if previous:
        return 0
    day = datetime.now(timezone.utc).date()
    used = await session.scalar(select(func.coalesce(func.sum(ParticipationAward.points), 0)).where(
        ParticipationAward.patient_id == patient_id, ParticipationAward.kind == kind, ParticipationAward.day == day))
    wanted = effort_units if kind == "survey" else RULES[kind]["daily_cap"]
    points = max(0, min(wanted, RULES[kind]["daily_cap"] - used))
    row = ParticipationAward(patient_id=patient_id, kind=kind, source_key=source_key,
        policy_version=POLICY_VERSION, points=points, day=day)
    session.add(row); await session.flush()
    record_event(session, actor_id, patient_id, "participation.recorded", "participation_award", row.id,
                 {"kind": kind, "points": points, "policy_version": POLICY_VERSION})
    return points


router = APIRouter(tags=["participation points"])


@router.get("/participation/points")
async def points(session: CompassSession, user: User = Depends(require_role([UserRole.patient]))):
    patient = await session.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    rows = (await session.scalars(select(ParticipationAward).where(ParticipationAward.patient_id == patient.id)
                                  .order_by(ParticipationAward.id.desc()))).all()
    today = datetime.now(timezone.utc).date()
    return {"balance": sum(r.points for r in rows), "policy_version": POLICY_VERSION,
        "policy_status": "demo_proposal", "exchange_enabled": False, "day_timezone": "UTC",
        "next_reset_at": datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
        "rules": [{"kind": k, **v, "earned_today": sum(r.points for r in rows if r.kind == k and r.day == today)} for k,v in RULES.items()],
        "history": [{"id": r.id, "kind": r.kind, "points": r.points, "created_at": r.created_at,
                     "policy_version": r.policy_version} for r in rows[:100]],
        "principles": ["Баллы за участие, а не за хорошее самочувствие или нужный ответ.",
            "Количество лекарств, пропущенные дни и доступ врача к дневнику не увеличивают и не уменьшают награду.",
            "После дневного лимита можно продолжать записи. Обмена на деньги, скидок и штрафов нет.",
            "Тариф предложен для демо; прежние синтетические записи задним числом не пересчитаны."]}
