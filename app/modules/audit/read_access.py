"""Persist bounded access metadata before releasing authenticated GET responses."""
import logging
from uuid import uuid4

from starlette.datastructures import QueryParams
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.db.session import async_session_read_audit
from app.modules.audit.models import ReadAccessEvent

logger = logging.getLogger(__name__)


def resource_ids(scope: Scope) -> dict[str, int]:
    values = dict(scope.get("path_params", {}))
    route = scope.get("route")
    if any(field.name == "patient_id" for field in getattr(getattr(route, "dependant", None), "query_params", [])):
        values.setdefault("patient_id", QueryParams(scope.get("query_string", b"")).get("patient_id"))
    result = {}
    for key, value in values.items():
        if not key.endswith("_id") or isinstance(value, bool):
            continue
        if isinstance(value, str):
            if not value.isascii() or not value.isdigit() or len(value) > 19:
                continue
            value = int(value)
        if isinstance(value, int) and 0 < value <= 9223372036854775807:
            result[key] = value
    return result


async def record_read_access(scope: Scope, status: int) -> None:
    actor_id, actor_role = scope["state"]["read_audit_actor"]
    async with async_session_read_audit() as session:
        session.add(ReadAccessEvent(actor_id=actor_id, actor_role=actor_role,
            route=getattr(scope.get("route"), "path", "<unknown>"), resource_ids=resource_ids(scope),
            http_status=status, request_id=str(uuid4())))
        await session.commit()


class ReadAccessMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "GET":
            await self.app(scope, receive, send)
            return
        attempted = False
        withheld = False

        async def send_with_audit(message: Message) -> None:
            nonlocal attempted, withheld
            if message["type"] == "http.response.start" and scope.get("state", {}).get("read_audit_actor"):
                attempted = True
                try:
                    await record_read_access(scope, message["status"])
                except Exception:
                    # No request URL, credentials, medical payload or exception parameters in this log.
                    logger.error("Read-access audit persistence failed; response withheld")
                    withheld = True
                    await JSONResponse({"detail":"Журнал доступа временно недоступен. Повторите запрос позже."},
                        status_code=503, headers={"Cache-Control":"no-store"})(scope, receive, send)
                    return
                message = {**message, "headers":[
                    (key, value) for key, value in message.get("headers", []) if key.lower() != b"cache-control"
                ] + [(b"cache-control", b"no-store")]}
            if not withheld:
                await send(message)

        try:
            await self.app(scope, receive, send_with_audit)
        except Exception:
            # An unhandled endpoint/serialization failure is converted to 500 by the outer server middleware.
            if not attempted and scope.get("state", {}).get("read_audit_actor"):
                try:
                    await record_read_access(scope, 500)
                except Exception:
                    logger.error("Read-access audit persistence failed for an unsuccessful request")
            raise
