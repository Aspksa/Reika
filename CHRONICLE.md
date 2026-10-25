# Chronicle: журнал проблем и ИИ-агентов

Project Chronicle ведёт отдельные истории **коммитов**, **релизов**, **ошибок** и **действий агентов**. Он не меняет версии при каждом событии. Результат записи сохраняется в `.chronicle/events.jsonl` (JSONL), который можно включить в Git обычным Pull Request. Не записывайте в события токены, пароли, персональные данные и секреты.

## Проблемы

```powershell
python scripts/chronicle.py problem --id BUG-0001 --status opened --details "Сбой загрузки" --actor codex
python scripts/chronicle.py problem --id BUG-0001 --status in_progress --details "Причина проверяется" --actor codex
python scripts/chronicle.py problem --id BUG-0001 --status fix_proposed --details "Подготовлен патч" --evidence "Ссылка на PR"
python scripts/chronicle.py problem --id BUG-0001 --status verified --details "Тесты прошли" --evidence "Ссылка на CI"
python scripts/chronicle.py problem --id BUG-0001 --status closed --details "Исправление опубликовано"
```

Статусы: opened, triaged, in_progress, fix_proposed, verified, closed, reopened. Закрытие требует предыдущего verified. Указание статуса — утверждение автора записи, не криптографическое доказательство проверки.

## ИИ-агенты

```powershell
python scripts/chronicle.py agent --agent codex --task TASK-0128 --action started --details "Начал работу"
python scripts/chronicle.py agent --agent claude --task TASK-0128 --action tested --details "Проверил исправление" --evidence "Ссылка на CI"
python scripts/chronicle.py validate
```

Поддерживаются события started, analyzed, proposed, changed, tested, failed, finished. Идентификатор агента — метка происхождения отчёта, не подтверждённая личность; её нельзя считать аутентификацией.

## Точные связи с коммитами

В **сообщении соответствующего коммита** добавляйте трейлеры:

```text
Исправить отображение галактики

Task-Id: TASK-0128
Fixes-Id: BUG-0001
```

Допускается Refs-Id. Только явно перечисленные ID попадут в `releases/commits.json`. Коммиты без трейлеров остаются unlinked; система не приписывает им все задачи релиза. Просмотр проверенных по Git сообщений:

```powershell
python scripts/chronicle.py links --base v0.4.0 --head HEAD
```

## Важные ограничения

Chronicle не запускает агентов самостоятельно и не наблюдает за их скрытыми действиями. Локальные события доступны другим агентам только после их передачи (например, через коммит/PR). Несколько независимых агентов должны работать в отдельных ветках и согласовывать конфликты при слиянии JSONL. Автоматическая проверка ссылается на Git-коммиты и CI; для реального подтверждения исправления нужны воспроизводимые тесты. Старые записи `releases/commits.json` не переатрибутируются автоматически: отсутствующие доказательства остаются неопределёнными.
