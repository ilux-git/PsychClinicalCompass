"""Clinic calendar agreed with the user; persisted instants remain timezone-aware."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

CLINIC_TIMEZONE = "Europe/Moscow"
CLINIC_ZONE = ZoneInfo(CLINIC_TIMEZONE)


def clinic_day(instant: datetime) -> date:
    if instant.tzinfo is None:
        raise ValueError("A timezone-aware instant is required")
    return instant.astimezone(CLINIC_ZONE).date()


def clinic_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, CLINIC_ZONE).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, CLINIC_ZONE).astimezone(timezone.utc)
    return start, end
