# Roadmap: Clinical Compass MVP

Приоритет от 22.10.2026: выяснять барьеры и причины со слов пациентов, дать врачу собственные опросы и показать пациенту пользу/прогресс участия. Два участника, 2–4 дня; LLM и живой Telegram не обязательны.

После показа технического MVP пользователь запросил общие workflows и полезные метрики, обезличенную админскую сводку и видимость ответов по состоянию. Продуктовый маршрут и формулы — docs/PRODUCT_PLAN.md; техническая приёмка фаз 1–4 не означает готовность этих новых результатов.

## Phases

- [x] **Phase 1: Foundation and patient access** — PostgreSQL, миграции, login, scope, 10 согласованных карточек.
- [x] **Phase 2: Feedback and patient participation** — конструктор, версии, назначения, ответы, барьеры/намерения, самоотчёты и прогресс.
- [ ] **Phase 3: Doctor workflow and event handling** — техническая реализация проверена; клиническая приёмка и резервный маршрут ожидают Q05/Q06.
- [x] **Phase 4: Demo and verification** — нативный стенд, браузерные сценарии/отказ/восстановление, production build и контейнерный CI проверены; handoff подготовлен.
- [ ] **Phase 5: Role workflows and clinic measurement** — видимая история PHQ-9/GAD-7, продуктовый план, согласованный состав обезличенной сводки, затем её отдельная реализация.

## Phase Details

### Phase 1: Foundation and patient access

**Goal**: запускаемый backend и границы доступа до чтения медицинских данных.
**Requirements**: FOUND-01, ACCESS-01, ACCESS-02, DATA-01, PATIENT-01.
**Success Criteria**: миграция/seed повторяемы; чужие данные и admin закрыты; MIS SELECT-only; источник/ошибка отображаются честно.
**Plans**: 1 plan.

- [x] 01-01: основа, доступ и API пациента; проверено на PostgreSQL 16.15. Отдельное ограничение — Docker daemon недоступен.

### Phase 2: Feedback and patient participation

**Goal**: врач получает конкретный ответ о барьере, пациент видит сохранённый вклад.
**Depends on**: Phase 1.
**Requirements**: SURVEY-01, SURVEY-02, FEEDBACK-01, RETENTION-01, ADHERENCE-01, MOTIVATION-01.
**Success Criteria**: свой опрос → публикация → назначение → ответ → аналитика; неизменяемые версии; повторы не увеличивают прогресс; неизвестность не становится уходом.
**Plans**: 1 plan.

- [x] 02-01: формы и назначения; ответы и участие; фактическая аналитика. CHURN-01/CLINIC-01/REWARD-01 ожидают Q02/Q03/Q04/Q07.

### Phase 3: Doctor workflow and event handling

**Goal**: первичный ответ становится заметкой/задачей либо обрабатываемым событием с ручным решением врача.
**Depends on**: Phase 2.
**Requirements**: MESSAGE-01, EVENT-01, NOTE-01, AUDIT-01, DECISION-TECH-01, AVAILABILITY-TECH-01; клинические ASSESS-01, ALERT-CLINICAL-01, FALLBACK-01 отдельно.
**Success Criteria**: общая история каналов; атомарность и идемпотентность; версия/автор решения; приватность заметок; отсутствие MIS-записей. Новые клинические тексты/правила и резервный маршрут — только после Q05/Q06.
**Plans**: 1 plan.

- [ ] 03-01: техническая часть завершена и проверена; клиническая часть блокируется согласованием, полная фаза не объявляется завершённой.

### Phase 4: Demo and verification

**Goal**: воспроизводимый показ полезного сценария, понятные ограничения и передача второму участнику.
**Depends on**: Phase 2 and technical part of Phase 3.
**Requirements**: UI-01, DEMO-01, CONTAINER-01.
**Success Criteria**: production build, браузерные сценарии и мобильная ширина, отказные тесты, повтор seed/миграций, инструкция и очередь вопросов. Контейнеры проверяются отдельно от нативного запуска.
**Plans**: 1 plan.

- [x] 04-01: 59 тестов, браузерные сценарии/отказ/восстановление, launcher, production build и успешный контейнерный CI; отчёт и очередь вопросов готовы.

### Phase 5: Role workflows and clinic measurement

**Goal**: перейти от набора модулей к проверяемому рабочему маршруту каждой роли и метрикам с источником, знаменателем и действием.
**Depends on**: technical MVP phases 1–4.
**Requirements**: WORKFLOW-01, ASSESS-VISIBLE-01, METRICS-01, ADMIN-AGG-01; расширение CLINIC-01.
**Success Criteria**: врач и пациент находят исходные ответы и сопоставимую динамику; для администратора согласованы информационные блоки до правил малых групп; отдельный агрегирующий контракт не раскрывает индивидуальные данные. Полный контур «действие → повторное наблюдение → возврат» не объявляется готовым без источников.
**Plans**: 1 plan.

- [ ] 05-01: план ролей/метрик и видимость шкал; состав админской сводки ожидает Q03. Следующие итерации описаны в docs/PRODUCT_PLAN.md.

## Progress

| Phase | Plans Complete | Status |
|---|---|---|
| 1. Foundation and patient access | 1/1 | Verified on native PostgreSQL |
| 2. Feedback and patient participation | 1/1 | Verified; business extensions await decisions |
| 3. Doctor workflow and event handling | 0/1 | Technical checks passed; Q05/Q06 |
| 4. Demo and verification | 1/1 | Verified native + browser + container CI |
| 5. Role workflows and clinic measurement | 0/1 | History and product plan in verification; admin contents await Q03 |

Очередь: docs/QUESTION_QUEUE.md. Подготовка следующего пункта не разрешает угадывать его бизнес-правила. Текущая работа продолжает все независимые задачи до их окончания.
