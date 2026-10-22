---
phase: 04-demo-and-verification
plan: "01"
subsystem: testing
status: complete
completed: 2026-10-22
requirements-completed: [UI-01, DEMO-01, CONTAINER-01]
---

# Проверенный технический стенд

59 pytest без пропусков; свежие миграции/roundtrip/backfill, повтор seed со сравнением всех counts, SQL SELECT-only, изоляция ролей, конкурентные повторы/атомарность и ручное решение. Production build проходит. Браузерные маршруты врача/пациента и мобильный 390×844, отказ/восстановление проверены. Настоящая сборка/Compose с двумя БД и init-порядком прошла на [GitHub Actions](https://github.com/ilux-git/PsychClinicalCompass/actions/runs/39650929690).

Сценарии и ограничения — docs/DEMO.md и docs/VERIFICATION.md. Снимки и локальный launcher находятся в игнорируемом outputs/. Main не изменялся. GSD consistency проходит; core-профиль не расширялся до тяжёлых агентов.

## Открыто

Это не клиническая приёмка. Q01–Q07 сохраняются, Phase 3 полного SUMMARY не имеет. Медицинские тексты, критерий потери клиента, общеклиническая роль, экономика награды и внешний резервный маршрут требуют решения пользователя.
