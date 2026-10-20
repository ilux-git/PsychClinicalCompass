import asyncio
import logging

from sqlalchemy import select, update

from app.core.config import get_settings
from app.db.session import async_session_compass
from app.modules.assessments.models import OutboxEvent
from app.modules.messaging.models import Message, MessageStatus

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("app.outbox_worker")


async def _handle_event(session, event: OutboxEvent) -> None:
    logger.info("dispatching outbox event id=%s type=%s payload=%s", event.id, event.event_type, event.payload)
    if event.event_type == "telegram.send_message":
        message_id = event.payload.get("message_id")
        if isinstance(message_id, int):
            await session.execute(update(Message).where(Message.id == message_id).values(status=MessageStatus.SENT))


async def process_pending_events() -> int:
    async with async_session_compass() as session:
        result = await session.execute(
            select(OutboxEvent).where(OutboxEvent.status == "pending").order_by(OutboxEvent.id).limit(50)
        )
        events = list(result.scalars())
        if not events:
            return 0
        for event in events:
            await _handle_event(session, event)
            await session.execute(update(OutboxEvent).where(OutboxEvent.id == event.id).values(status="processed"))
        await session.commit()
        return len(events)


async def main() -> None:
    interval = get_settings().outbox_poll_interval_seconds
    logger.info("outbox worker started, poll interval=%ss", interval)
    while True:
        try:
            processed = await process_pending_events()
            if processed:
                logger.info("processed %s events", processed)
        except Exception:
            logger.exception("outbox poll failed")
        await asyncio.sleep(interval)


if __name__ == "__main__":
    asyncio.run(main())
