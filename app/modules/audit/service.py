from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditEvent


def record_event(session: AsyncSession, actor_id: int | None, patient_id: int | None,
                 event_type: str, object_type: str, object_id: int, details: dict | None = None) -> None:
    session.add(AuditEvent(actor_id=actor_id, patient_id=patient_id, event_type=event_type,
                           object_type=object_type, object_id=object_id, details=details or {}))
