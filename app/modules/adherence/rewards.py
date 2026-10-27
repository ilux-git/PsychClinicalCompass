"""Effort-based awards and explicitly simulated loyalty coupons."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, UniqueConstraint, bindparam, func, select
from sqlalchemy.orm import Mapped, mapped_column
from pydantic import BaseModel

from app.api.deps import CompassSession, patient_for_user, require_role
from app.db.base import Base
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.core.clinic_time import CLINIC_TIMEZONE,clinic_day,clinic_day_bounds

POLICY_VERSION = "demo-effort-msk-v3"
CLINICAL_POLICY_VERSION = "demo-clinical-completion-msk-v2"
CATALOG_VERSION = "demo-visit-discounts-v1"
OFFERS = {
    "visit_5": {"title": "Скидка 5% на приём врача", "points": 100, "discount_percent": 5},
    "visit_10": {"title": "Скидка 10% на приём врача", "points": 250, "discount_percent": 10},
}
RULES = {
    "survey": {"label": "Опросы", "daily_cap": 30, "description": "Авторские формы: 1 балл за пункт, 2 за текстовый. Клинические: по числу пунктов полного бланка, независимо от ответов и ветки. Всего до 30 в день"},
    "medication": {"label": "Отчёты о приёме лекарств", "daily_cap": 10, "description": "10 баллов за отчёт о приёме, максимум 10 в сутки. Ответ о пропуске или неизвестном результате равноправен отметке приёма. Создание и изменение расписания — без баллов"},
    "diary": {"label": "Дневник состояния", "daily_cap": 10, "description": "10 баллов за запись, максимум 10 в сутки; личная и общая запись равноправны"},
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


class DemoCoupon(Base):
    __tablename__ = "demo_loyalty_coupons"
    __table_args__ = (
        UniqueConstraint("patient_id", "client_request_id", name="uq_demo_coupon_request"),
        UniqueConstraint("code", name="uq_demo_coupon_code"),
        CheckConstraint("status IN ('issued', 'cancelled')", name="ck_demo_coupon_status"),
        CheckConstraint("points > 0 AND discount_percent > 0 AND discount_percent <= 100", name="ck_demo_coupon_value"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    catalog_version: Mapped[str] = mapped_column(String(40), nullable=False)
    offer_id: Mapped[str] = mapped_column(String(32), nullable=False)
    points: Mapped[int] = mapped_column(nullable=False)
    discount_percent: Mapped[int] = mapped_column(nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="issued", server_default="issued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ParticipationPreference(Base):
    __tablename__ = "participation_preferences"
    __table_args__ = (
        CheckConstraint("patient_choice IS NULL OR patient_choice IN ('map','rhythm','calm')", name="ck_patient_game_mode"),
        CheckConstraint("doctor_recommendation IS NULL OR doctor_recommendation IN ('map','rhythm','calm')", name="ck_doctor_game_mode"),
    )
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), primary_key=True)
    patient_choice: Mapped[str | None] = mapped_column(String(16))
    doctor_recommendation: Mapped[str | None] = mapped_column(String(16))


class CouponRequest(BaseModel):
    offer_id: Literal["visit_5", "visit_10"]
    catalog_version: str
    client_request_id: UUID


class ModeRequest(BaseModel):
    mode: Literal["map", "rhythm", "calm"] | None


_OWN_PATIENT = select(Patient).where(Patient.user_id == bindparam("scope_user_id"))
_OWN_PATIENT_LOCKED = _OWN_PATIENT.with_for_update()
_AWARD_HISTORY = select(ParticipationAward).where(ParticipationAward.patient_id == bindparam("scope_patient_id")).order_by(ParticipationAward.id.desc())
_COUPON_HISTORY = select(DemoCoupon).where(DemoCoupon.patient_id == bindparam("scope_patient_id")).order_by(DemoCoupon.id.desc())
_POINTS_ACCOUNT = select(Patient.id, ParticipationPreference.patient_choice, ParticipationPreference.doctor_recommendation).outerjoin(
    ParticipationPreference, ParticipationPreference.patient_id == Patient.id).where(Patient.user_id == bindparam("scope_user_id"))


def preference_read(row):
    return {"patient_choice": row.patient_choice if row else None,
            "doctor_recommendation": row.doctor_recommendation if row else None,
            "effective_mode": (row.patient_choice or row.doctor_recommendation) if row and (row.patient_choice or row.doctor_recommendation) else "map"}


async def own_patient(session, user, lock=False):
    patient = await session.scalar(_OWN_PATIENT_LOCKED if lock else _OWN_PATIENT, {"scope_user_id": user.id})
    if patient is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    return patient


async def earned_and_reserved(session, patient_id):
    earned = await session.scalar(select(func.coalesce(func.sum(ParticipationAward.points), 0)).where(ParticipationAward.patient_id == patient_id))
    reserved = await session.scalar(select(func.coalesce(func.sum(DemoCoupon.points), 0)).where(
        DemoCoupon.patient_id == patient_id, DemoCoupon.status == "issued"))
    return earned, reserved


def coupon_read(row):
    return {"id": row.id, "code": row.code, "offer_id": row.offer_id, "catalog_version": row.catalog_version,
            "points": row.points, "discount_percent": row.discount_percent, "status": row.status,
            "created_at": row.created_at.isoformat(),
            "cancelled_at": row.cancelled_at.isoformat() if row.cancelled_at else None, "simulated": True}


async def grant_points(session, patient_id, kind, source_key, actor_id, effort_units=1, *, policy_version=POLICY_VERSION):
    # One lock also serializes different action types and concurrent source requests.
    await session.scalar(select(Patient).where(Patient.id == patient_id).with_for_update())
    previous = await session.scalar(select(ParticipationAward).where(ParticipationAward.patient_id == patient_id,
        ParticipationAward.kind == kind, ParticipationAward.source_key == source_key))
    if previous:
        return 0
    now=datetime.now(timezone.utc)
    day=clinic_day(now)
    start,end=clinic_day_bounds(day)
    used = await session.scalar(select(func.coalesce(func.sum(ParticipationAward.points), 0)).where(
        ParticipationAward.patient_id == patient_id, ParticipationAward.kind == kind,
        ParticipationAward.created_at>=start,ParticipationAward.created_at<end))
    wanted = effort_units if kind == "survey" else RULES[kind]["daily_cap"] if effort_units > 0 else 0
    points = max(0, min(wanted, RULES[kind]["daily_cap"] - used))
    row = ParticipationAward(patient_id=patient_id, kind=kind, source_key=source_key,
        policy_version=policy_version, points=points, day=day,created_at=now)
    session.add(row); await session.flush()
    record_event(session, actor_id, patient_id, "participation.recorded", "participation_award", row.id,
                 {"kind": kind, "points": points, "policy_version": policy_version})
    return points


async def participation_receipt(session, patient_id, kind, source_key):
    """Read the existing award; legacy sources without a ledger row stay unknown."""
    row = await session.scalar(select(ParticipationAward).where(
        ParticipationAward.patient_id == patient_id, ParticipationAward.kind == kind,
        ParticipationAward.source_key == source_key))
    return {"points": row.points, "policy_version": row.policy_version,
            "recorded_at": row.created_at} if row is not None else None


router = APIRouter(tags=["participation points"])


@router.get("/participation/points")
async def points(session: CompassSession, user: User = Depends(require_role([UserRole.patient]))) -> dict:
    account = (await session.execute(_POINTS_ACCOUNT, {"scope_user_id": user.id})).one_or_none()
    if account is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    params = {"scope_patient_id": account.id}
    rows = (await session.scalars(_AWARD_HISTORY, params)).all()
    today = clinic_day(datetime.now(timezone.utc))
    activity = defaultdict(lambda: [0, 0])
    earned_today = defaultdict(int)
    earned = 0
    for row in rows:
        recorded_day = clinic_day(row.created_at)
        activity[recorded_day][0] += 1
        activity[recorded_day][1] += row.points
        earned += row.points
        if recorded_day == today:
            earned_today[row.kind] += row.points
    coupons = (await session.scalars(_COUPON_HISTORY, params)).all()
    reserved = sum(c.points for c in coupons if c.status == "issued")
    return {"balance": earned-reserved, "earned_total": earned, "reserved_points": reserved, "policy_version": POLICY_VERSION,
        "policy_status": "demo_proposal", "exchange_enabled": False, "day_timezone": CLINIC_TIMEZONE,
        "demo_exchange_enabled": True, "catalog_version": CATALOG_VERSION,
        "offers": [{"id": key, **offer} for key, offer in OFFERS.items()],
        "coupons": [coupon_read(c) for c in coupons[:100]], "preference": preference_read(account),
        "activity": [{"day": day.isoformat(), "actions": activity[day][0], "points": activity[day][1]}
                     for day in (today-timedelta(days=i) for i in range(6,-1,-1))],
        "next_reset_at": clinic_day_bounds(today)[1].isoformat(),
        "rules": [{"kind": k, **v, "earned_today": earned_today[k]} for k,v in RULES.items()],
        "history": [{"id": r.id, "kind": r.kind, "points": r.points, "created_at": r.created_at.isoformat(),
                     "policy_version": r.policy_version} for r in rows[:100]],
        "principles": ["Баллы за участие, а не за хорошее самочувствие или нужный ответ.",
            "Количество лекарств, пропущенные дни и доступ врача к дневнику не увеличивают и не уменьшают награду.",
            "После дневного лимита можно продолжать записи. Штрафов и сгорания за пропуски нет.",
            "Обмен на скидочный купон — симуляция. Реальная скидка, цена приёма и оплата в клинике не меняются.",
            "Тариф предложен для демо; прежние записи не пересчитываются."]}


@router.post("/participation/demo-coupons", status_code=201)
async def issue_coupon(payload: CouponRequest, session: CompassSession, user: User = Depends(require_role([UserRole.patient]))):
    patient = await own_patient(session, user, lock=True)
    previous = await session.scalar(select(DemoCoupon).where(DemoCoupon.patient_id == patient.id,
        DemoCoupon.client_request_id == str(payload.client_request_id)))
    if previous:
        if previous.offer_id != payload.offer_id or previous.catalog_version != payload.catalog_version:
            raise HTTPException(409, "Этот запрос уже использован для другого купона")
        return coupon_read(previous)
    if payload.catalog_version != CATALOG_VERSION:
        raise HTTPException(409, "Условия изменились. Обновите предложения перед обменом")
    offer = OFFERS[payload.offer_id]
    earned, reserved = await earned_and_reserved(session, patient.id)
    if earned-reserved < offer["points"]:
        raise HTTPException(409, "Пока недостаточно доступных баллов для этого купона")
    row = DemoCoupon(patient_id=patient.id, client_request_id=str(payload.client_request_id),
        catalog_version=CATALOG_VERSION, offer_id=payload.offer_id, points=offer["points"],
        discount_percent=offer["discount_percent"], code="DEMO-"+uuid4().hex[:12].upper())
    session.add(row); await session.flush()
    record_event(session, user.id, patient.id, "loyalty.demo_coupon_issued", "demo_coupon", row.id,
                 {"points": row.points, "catalog_version": CATALOG_VERSION, "simulated": True})
    await session.commit()
    return coupon_read(row)


@router.post("/participation/demo-coupons/{coupon_id}/cancel")
async def cancel_coupon(coupon_id: int, session: CompassSession, user: User = Depends(require_role([UserRole.patient]))):
    patient = await own_patient(session, user, lock=True)
    row = await session.scalar(select(DemoCoupon).where(DemoCoupon.id == coupon_id, DemoCoupon.patient_id == patient.id).with_for_update())
    if row is None: raise HTTPException(404, "Купон не найден")
    if row.status != "cancelled":
        row.status, row.cancelled_at = "cancelled", datetime.now(timezone.utc)
        record_event(session, user.id, patient.id, "loyalty.demo_coupon_cancelled", "demo_coupon", row.id, {"simulated": True})
    await session.commit()
    return coupon_read(row)


@router.put("/participation/preferences")
async def patient_preference(payload: ModeRequest, session: CompassSession, user: User = Depends(require_role([UserRole.patient]))):
    patient = await own_patient(session, user, lock=True)
    row = await session.get(ParticipationPreference, patient.id)
    if row is None:
        row = ParticipationPreference(patient_id=patient.id); session.add(row)
    if row.patient_choice != payload.mode:
        row.patient_choice = payload.mode
        record_event(session, user.id, patient.id, "participation.mode_chosen", "patient", patient.id, {"mode": payload.mode})
    await session.commit()
    return preference_read(row)


@router.get("/patients/{patient_id}/motivation")
async def get_motivation(patient_id: int, session: CompassSession, user: User = Depends(require_role([UserRole.doctor]))):
    await patient_for_user(session, user, patient_id)
    return preference_read(await session.get(ParticipationPreference, patient_id))


@router.put("/patients/{patient_id}/motivation")
async def recommend_motivation(patient_id: int, payload: ModeRequest, session: CompassSession,
        user: User = Depends(require_role([UserRole.doctor]))):
    patient = await session.scalar(select(Patient).where(Patient.id == patient_id, Patient.doctor_id == user.id).with_for_update())
    if patient is None: raise HTTPException(404, "Пациент не найден или недоступен")
    row = await session.get(ParticipationPreference, patient_id)
    if row is None:
        row = ParticipationPreference(patient_id=patient_id); session.add(row)
    if row.doctor_recommendation != payload.mode:
        row.doctor_recommendation = payload.mode
        record_event(session, user.id, patient_id, "participation.mode_recommended", "patient", patient_id, {"mode": payload.mode})
    await session.commit()
    return preference_read(row)
