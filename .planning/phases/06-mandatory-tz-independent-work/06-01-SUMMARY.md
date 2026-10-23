---
phase: 06-mandatory-tz-independent-work
plan: "01"
subsystem: alerts-and-verification
tags: [inbox, scope, audit, backup, timings]
requires: [technical-mvp]
provides: [doctor-inbox, presentation-receipts, restore-verification, mandatory-tz-priorities]
affects: [clinical-workflow, deployment-acceptance]
tech-stack:
  added: []
  patterns: [per-doctor-presentation, exported-mvcc-snapshot]
key-files:
  created: [frontend/src/DoctorInbox.tsx, scripts/verify_backup_restore.py, scripts/benchmark_api.py, docs/TZ_PRIORITY_PLAN.md, docs/BLOCKERS.md]
  modified: [app/modules/alerts/router.py, app/modules/alerts/models.py, frontend/src/App.tsx]
key-decisions:
  - "Presentation is separate from human reading, acknowledgement and clinical approval."
  - "Restore accepts only a different empty *_restore_test database; source remains read-only."
  - "Medical sources are candidates pending approval; C05 is still partial."
requirements-completed: [INBOX-TECH-01, SOURCE-PREP-01, RESTORE-TECH-01, LATENCY-TECH-01]
completed: 2026-10-23
---

# Phase 6 Plan 1: независимая часть обязательного ТЗ

По поручению пользователя составлен порядок C01–C11 и выделены B01–B04. Содержательные медицинские/эксплуатационные вопросы не решались предположениями.

## Выполнено

1. Первичные ссылки и паспорта согласования PHQ-9/GAD-7, ГРЛС/КР; конкретная инструкция Авиандра, клинические профили и применение ждут B02.
2. Общая очередь текущего врача, страницы/общие counts; показ видимой строки активной вкладки с серверным автором/временем и единичным аудитом. Принятие в работу и клиническое решение сохранены отдельными. При передаче пациента показ нового врача считается независимо.
3. Утилиты read-only API baseline и snapshot backup/restore. Восстановлена отдельная пустая test DB, сверены таблицы/последовательности и чтение приложением.

## Проверка

- Полный backend 66 passed in 36.48s; финальная прицельная группа 10 passed in 3.34s, включая новый rollback и guards (71 уникальный тест в совокупности, без skips).
- Миграции fresh/backfill/downgrade/upgrade, native alembic check; TypeScript/Vite build success.
- Desktop/mobile браузер, отдельные стадии, переход к исходной карточке. Новый synthetic probe: 1,759 с до события, 9,001 с до показа, 31,250 с до принятия; decision pending_review/MIS false.
- Backup/restore: 18 совпадающих таблиц, 17 последовательностей, 0,270/0,427 с; nonempty guard, restored API и admin 403. 150/150 успешных GET, p95 3,665–6,938 мс при concurrency 1.

Команды и границы: docs/OPERATIONS_CHECKS.md. Локальные доказательства находятся в игнорируемом outputs/. Публикация/CI новых файлов не заявлены.

## Следующий шаг

B02 → утверждённый клинический кейс; B01 → контракт ЭМК; B03 → внешний экстренный маршрут; B04 → среда/апробация. Полный C05, C02/C04/C06–C08/C10/C11 остаются открытыми; admin-состав Q03 и удержание Q02/Q07 отдельно. Phase 6 отмечает завершённую инженерную итерацию, а не весь MVP или медицинское соответствие.
