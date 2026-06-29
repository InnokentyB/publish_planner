# Reddit Parser Commit Plan

## Purpose
Этот документ нужен, чтобы аккуратно перенести уже подготовленные изменения в репозиторий `reddit-parser`.

Рядом лежит готовый patch:
- [reddit-parser-schema-bootstrap.patch](/Users/innokentyb/Ba_post_planner/ops/patches/reddit-parser-schema-bootstrap.patch)

## Что меняется

Patch подготавливает `reddit-parser` к работе в схеме `parser` без переписывания всех SQLAlchemy-моделей.

Идея такая:
- schema задается через `PARSER_DB_SCHEMA`
- для Postgres выставляется `search_path = parser, public`
- schema `parser` создается автоматически при инициализации
- один и тот же bootstrap используют:
  - API
  - worker
  - scheduler

## Какие файлы меняются во второй репе

1. [app/config.py](/tmp/reddit-parser-inspect/app/config.py)
- добавляется `default_database_schema()`

2. [app/db.py](/tmp/reddit-parser-inspect/app/db.py)
- добавляется нормализация schema name
- добавляется настройка Postgres `search_path`
- добавляется `initialize_database()`

3. [app/main.py](/tmp/reddit-parser-inspect/app/main.py)
- API начинает использовать общий schema-aware bootstrap

4. [app/worker.py](/tmp/reddit-parser-inspect/app/worker.py)
- worker начинает использовать общий schema-aware bootstrap

5. [app/scheduler.py](/tmp/reddit-parser-inspect/app/scheduler.py)
- scheduler начинает использовать общий schema-aware bootstrap

6. [README.md](/tmp/reddit-parser-inspect/README.md)
- добавляется документация по `PARSER_DB_SCHEMA=parser`

## Почему выбран именно такой подход

Вместо того чтобы:
- прописывать schema вручную в каждой модели
- менять все foreign keys
- отдельно чинить raw SQL

мы делаем проще и безопаснее:
- вся репа смотрит в нужную схему через `search_path`

Плюсы:
- меньше diff
- меньше риск пропустить таблицу
- легче rollout
- легче поддержка worker/scheduler/API одним способом

## Что уже проверено

В локальном клоне было проверено:
- `python3 -m compileall /tmp/reddit-parser-inspect/app`

Что еще не проверено:
- `pytest`
- реальный запуск против Postgres в схеме `parser`
- Railway deploy

## Как перенести изменения в сам `reddit-parser`

### Вариант 1. Применить patch
В репозитории `reddit-parser`:

```bash
git apply /Users/innokentyb/Ba_post_planner/ops/patches/reddit-parser-schema-bootstrap.patch
```

Потом проверить:

```bash
git diff
```

### Вариант 2. Перенести вручную
Если patch не применится cleanly:
- взять изменения из patch
- перенести их вручную в перечисленные файлы

## Что прогнать после применения patch

Минимум:

```bash
python3 -m compileall app
python3 -m pytest -q
```

Если есть локальный Postgres:

```bash
export APP_DATABASE_URL='postgresql+psycopg2://...'
export PARSER_DB_SCHEMA=parser
python3 -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

И отдельно:

```bash
export APP_DATABASE_URL='postgresql+psycopg2://...'
export PARSER_DB_SCHEMA=parser
python3 -m app.worker --once
python3 -m app.scheduler --once
```

## Acceptance criteria для коммита во второй репе

Коммит считаем готовым, если:

1. API стартует с `PARSER_DB_SCHEMA=parser`
2. worker стартует с `PARSER_DB_SCHEMA=parser`
3. scheduler стартует с `PARSER_DB_SCHEMA=parser`
4. schema `parser` создается автоматически, если ее нет
5. таблицы создаются не в `public`, а в `parser`
6. in-memory SQLite тесты не ломаются
7. README отражает новый env contract

## Рекомендуемый commit message

```text
Add parser schema bootstrap for Postgres deployments
```

## Рекомендуемый rollout order на Railway

1. Подготовить env:
   - `APP_DATABASE_URL`
   - `PARSER_DB_SCHEMA=parser`
   - `PARSER_SERVICE_TOKEN`
2. Сначала выкатить `reddit-parser-api`
3. Проверить `/health`
4. Потом выкатить `reddit-parser-worker`
5. Потом выкатить `reddit-parser-scheduler`

## Что делать после этого

Когда этот patch окажется в `reddit-parser`:
- можно переходить к интеграции planner -> parser
- в `Ba_post_planner` следующим шагом уже логично делать:
  - `parser_integration.service.ts`
  - planner parser endpoints
  - потом parser-aware MCP tools
