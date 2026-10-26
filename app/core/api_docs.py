"""Local API reference without browser scripts from third-party CDNs."""
from html import escape

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get('/docs', include_in_schema=False, response_class=HTMLResponse)
async def api_reference(request: Request) -> str:
    rows = []
    for path, operations in request.app.openapi()['paths'].items():
        for method, operation in operations.items():
            if method not in {'get', 'post', 'put', 'patch', 'delete', 'options', 'head'}:
                continue
            rows.append('<tr><td>'+escape(method.upper())+'</td><td><code>'+escape(path)+
                        '</code></td><td>'+escape(operation.get('summary', ''))+'</td></tr>')
    return '''<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Описание API · Лимбус</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#18191a;background:#f6f4ef;margin:0;padding:32px}
main{max-width:1100px;margin:auto}h1{line-height:1.25}a{color:#165766}table{border-collapse:collapse;width:100%;background:white}
th,td{text-align:left;padding:12px 16px;border-bottom:1px solid #d7d5cf;vertical-align:top}code{overflow-wrap:anywhere}
@media(max-width:600px){body{padding:16px}th,td{padding:10px 8px;font-size:13px}}</style>
<main><h1>Описание API</h1><p>Синтетический демонстрационный стенд. Клинические данные доступны только с авторизацией и проверкой связи с пациентом.</p>
<p><a href="/openapi.json">Схема OpenAPI в JSON</a> для импорта в локальный клиент API. Эта страница не загружает сторонние скрипты и не отправляет запросы от Вашего имени.</p>
<table><thead><tr><th>Метод</th><th>Адрес</th><th>Операция</th></tr></thead><tbody>'''+''.join(rows)+'</tbody></table></main></html>'
