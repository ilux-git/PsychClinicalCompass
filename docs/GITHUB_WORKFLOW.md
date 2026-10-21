# Доступ к GitHub без ожидания владельца

Проверено через GitHub API 21.10.2026. Репозиторий публичный, владелец `ilux-git` - личный аккаунт, default branch `main`.

## Текущее состояние

- [main-1](https://github.com/ilux-git/PsychClinicalCompass/rules/25500777): запрет удаления ветки и force push.
- [main-2](https://github.com/ilux-git/PsychClinicalCompass/rules/25500778): обязателен PR и 1 одобрение; после новых commits прежние одобрения сбрасываются.
- Обязательный CODEOWNERS, отдельное одобрение последнего push и обязательное закрытие review threads сейчас выключены. В эффективном списке правил main обязательных status checks не обнаружено.
- Личные права пользователя и скрытые bypass-настройки не проверялись: публичный API не подтверждает, что конкретный пользователь уже collaborator.

## Однократные действия владельца на хакатон

1. Settings -> Collaborators -> Add people: пригласить GitHub-аккаунт участника, если он ещё не collaborator. Участник принимает приглашение.
2. Settings -> Rules -> Rulesets -> main-2: оставить Require a pull request before merging, изменить Required approvals с 1 на 0. Сохранить правило активным.
3. main-1 оставить активным. Доступ через bypass для этого варианта не требуется.

После этого collaborator может сам push-ить рабочие ветки, создавать PR и выполнять merge при выполнении остальных правил. Для работы по коду участие владельца в каждом PR не требуется. PR по-прежнему остаётся журналом изменений. Локальные/CI-проверки выполняются по процессу проекта, даже если GitHub не требует чужого approval.

Проверить после настройки: открытый PR авторства участника не требует одобрения владельца; кнопка merge доступна при отсутствии конфликтов. Этот документ описывает предложение; настройки удалённого репозитория в данной задаче не менялись.

## Если нужна самостоятельность в настройках

У личного репозитория есть владелец и collaborators; отдельную роль Admin другому участнику так не выдать. Для самостоятельной настройки rulesets, сервисов и других административных параметров рассмотреть перенос репозитория в GitHub Organization и выдать участнику роль Admin только на этот репозиторий. Перенос имеет отдельный объём и в текущей задаче не выполнялся.

Для 2-4 дней рекомендован первый вариант: collaborator + PR без обязательного approval. Для следующих этапов требования к независимому ревью можно вернуть.

## Источники

- [Права в личном репозитории](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)
- [Приглашение collaborator](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)
- [Правила rulesets и ноль обязательных approvals](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
