# Roadmap: Clinical Compass MVP

Приоритет от 22.10.2026: выяснять барьеры и причины со слов пациентов, дать врачу собственные опросы и показать пациенту пользу/прогресс участия. Два участника, 2–4 дня; LLM и живой Telegram не обязательны.

После показа технического MVP пользователь запросил общие workflows и полезные метрики, обезличенную админскую сводку и видимость ответов по состоянию. Продуктовый маршрут и формулы — docs/PRODUCT_PLAN.md; техническая приёмка фаз 1–4 не означает готовность этих новых результатов.

## Phases

- [x] **Phase 1: Foundation and patient access** — PostgreSQL, миграции, login, scope, 10 согласованных карточек.
- [x] **Phase 2: Feedback and patient participation** — конструктор, версии, назначения, ответы, барьеры/намерения, самоотчёты и прогресс.
- [ ] **Phase 3: Doctor workflow and event handling** — техническая реализация проверена; клиническая приёмка и резервный маршрут ожидают Q05/Q06.
- [x] **Phase 4: Demo and verification** — нативный стенд, браузерные сценарии/отказ/восстановление, production build и контейнерный CI проверены; handoff подготовлен.
- [ ] **Phase 5: Role workflows and clinic measurement** — технические маршруты/метрики и сводка реализованы; продуктовая приёмка и политика реальных групп остаются открытыми.
- [x] **Phase 6: Mandatory TZ independent work** — приоритеты C01–C11, очередь событий врача, показ/принятие, источники на согласование, API-замеры и изолированный backup/restore. Полное клиническое соответствие не входит в эту техническую отметку.
- [x] **Phase 7: Analytics data collection** — четыре направления/категории, измеренное открытие/воронка, приватное наблюдение врача с источником, управляемый дневник и закрытый до политики групп admin API/UI. Внешние источники описаны, не симулируются.
- [x] **Phase 8: Care workflows and applied decisions** — ручные исходы, источник/исполнитель/проверка задач, координатор, JSON МИС, личные расписания, баллы, структурированный дневник и настраиваемая сводка. Доступная независимая реализация проверена; оставшиеся решения U01–U07.

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

- [ ] 05-01: видимость шкал, все роли и технические метрики реализованы в Phase 5–8; полная продуктовая приёмка и политика реального пилота — U05. Актуальный результат — docs/MVP_WORKFLOWS.md.

### Phase 6: Mandatory TZ independent work

**Goal**: по поручению 23.10 закрыть независимые инженерные пробелы обязательного ТЗ и отдельно собрать решения, от которых зависит клиническая реализация.
**Depends on**: technical MVP; docs/TZ_GAP_ANALYSIS.md.
**Requirements**: C01/C03/C05-TECH/C08-PREP/C11-TECH, T01/T04/T06.
**Success Criteria**: общая owned-очередь, отдельные показ/принятие/решение и атомарный аудит; источники имеют проверенный статус; restore только в пустую тестовую БД с совпадающими данными, замеры с границами применимости; B01–B04 выделены.
**Plans**: 1 plan.

- [x] 06-01: независимая итерация выполнена; native PostgreSQL, миграции, build, браузер, восстановление и контрольные API проверены. Следующая клиническая работа зависит от B01–B04.

### Phase 7: Analytics data collection

**Goal**: реализовать независимый сбор по изображению пользователя, сохранив разные источники и неизвестные измерения.
**Requirements**: ANALYTICS-DIMENSIONS-01, SURVEY-TIMING-01, DOCTOR-OBSERVATION-01, DIARY-01, ADMIN-AGG-TECH-01.
**Success Criteria**: вопросы/версии размечены явно; первый видимый показ и серверные интервалы без исторической подстановки; наблюдение врача приватно и не меняет ответы; дневник разделяется пациентом; admin не возвращает индивидуальные данные/тексты, без политики значения закрыты. Не выдуманы индексы/интеграции.
**Plans**: 1 plan.

- [x] 07-01: 81 тест, migration roundtrip/check, build, браузер/мобильный. Исследование и очередь N01–N09 сохранены как предыдущая итерация; последующие ответы применены в Phase 8.

### Исследовательская итерация 23.10.2026

По прямому поручению до новых вопросов и реализации выполнен обзор первоисточников: docs/RESEARCH_REVIEW.md, docs/RESEARCH_SOURCES.md и docs/INTEGRATIONS_RESEARCH.md. Ответы пользователя зафиксированы, подготовлены конкретные предложения по формам/наблюдениям/дневнику и метрики с известными знаменателями. Новый приоритетный план — раздел 12 обзора; очередь N01–N09 — docs/ANALYTICS_QUESTIONS.md. В этой итерации прикладной код не менялся. Исследование не закрывает клинические/ЭМК/кризисные обязательства ТЗ и не увеличивает число принятых технических фаз.

### Phase 8: Care workflows and applied decisions

**Goal**: применить ответы пользователя и выполнить весь независимый объём до конкретных медицинских/интеграционных решений.
**Requirements**: CARE-STATUS-01, CARE-TASK-01, COORDINATOR-01, VISIT-DATA-01, MEDICATION-REMINDER-01, PARTICIPATION-POINTS-01, ADMIN-POLICY-01, DIARY-OBSERVATION-01, SUPPORT-TEMPLATE-01, DEMO-SCENARIOS-01.
**Success Criteria**: полный синтетический маршрут ролей; неизвестность сохранена; атомарные начисления/аудит и повторы; узкие права; отдельные источники/зрелые знаменатели; миграции/restore/build/браузер проверены. Реальная МИС, медицинские пороги и внешняя доставка не придуманы.
**Plans**: 1 plan, четыре короткие итерации 08-01–08-04.

- [x] 08: JSON/сценарии и ручные исходы → расписания/самоотчёты → баллы/дневник/редактируемая общая анкета → admin/метрики и приёмка. Полный pytest 103/103, после дополнения seed 8/8; native head/check, production build, браузер четырёх ролей/390 px и restore 24 таблиц/23 последовательностей. План/результат: phases/08-care-workflows/08-PLAN.md и 08-SUMMARY.md.

## Progress

| Phase | Plans Complete | Status |
|---|---|---|
| 1. Foundation and patient access | 1/1 | Verified on native PostgreSQL |
| 2. Feedback and patient participation | 1/1 | Verified; business extensions await decisions |
| 3. Doctor workflow and event handling | 0/1 | Technical checks passed; Q05/Q06 |
| 4. Demo and verification | 1/1 | Verified native + browser + container CI |
| 5. Role workflows and clinic measurement | 0/1 | Technical workflows/metrics ready; product acceptance and real-data privacy policy remain open |
| 6. Mandatory TZ independent work | 1/1 | Inbox, sources preparation, technical timings and restore verified; clinical mandatory gates remain open |
| 7. Analytics data collection | 1/1 | Collection, private observation, diary and guarded aggregates verified; research completed |
| 8. Care workflows and applied decisions | 1/1 | Independent implementation verified; remaining clinical/external decisions U01–U07 |

Актуальная очередь: docs/OPEN_QUESTIONS.md. Q/N — история. Прогресс 6/8 относится к независимой технической приёмке, не к проценту медицинского ТЗ. Новое конкретное решение применяется без повторного разрешения продолжать.
