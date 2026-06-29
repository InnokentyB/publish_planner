# Railway Automation

## Что автоматизируем
В текущем конфиге можно автоматизировать почти все, кроме:
- первого `railway login`
- первого ручного выбора/создания сервисов в UI
- SQL cutover в Supabase

Автоматизируемое:
- build/start config сервисов
- состав переменных
- домены
- post-deploy smoke

## Где лежат конфиги
Конфиги сервисов:
- [planner-app.railway.json](/Users/innokentyb/Ba_post_planner/ops/railway/planner-app.railway.json)
- [planner-mcp.railway.json](/Users/innokentyb/Ba_post_planner/ops/railway/planner-mcp.railway.json)
- [parser-api.railway.json](/Users/innokentyb/Ba_post_planner/ops/railway/parser-api.railway.json)
- [parser-worker.railway.json](/Users/innokentyb/Ba_post_planner/ops/railway/parser-worker.railway.json)
- [parser-scheduler.railway.json](/Users/innokentyb/Ba_post_planner/ops/railway/parser-scheduler.railway.json)

Шаблоны переменных:
- [planner-app.env.example](/Users/innokentyb/Ba_post_planner/ops/railway/env/planner-app.env.example)
- [planner-mcp.env.example](/Users/innokentyb/Ba_post_planner/ops/railway/env/planner-mcp.env.example)
- [parser-api.env.example](/Users/innokentyb/Ba_post_planner/ops/railway/env/parser-api.env.example)
- [parser-worker.env.example](/Users/innokentyb/Ba_post_planner/ops/railway/env/parser-worker.env.example)
- [parser-scheduler.env.example](/Users/innokentyb/Ba_post_planner/ops/railway/env/parser-scheduler.env.example)

Скрипты применения:
- [apply-service-vars.sh](/Users/innokentyb/Ba_post_planner/scripts/railway/apply-service-vars.sh)
- [apply-domain.sh](/Users/innokentyb/Ba_post_planner/scripts/railway/apply-domain.sh)
- [post-deploy-smoke.sh](/Users/innokentyb/Ba_post_planner/scripts/railway/post-deploy-smoke.sh)

## Принятый единый стандарт переменных
Для всех сервисов используем:
- `APP_DATABASE_URL`
- `APP_DB_SCHEMA`

Дополнительно для planner migrations:
- `APP_DIRECT_DATABASE_URL`

Совместимость на переходный период:
- planner legacy: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `PLANNER_DB_SCHEMA`, `PLANNER_TARGET_SCHEMA`
- parser legacy: `PARSER_DB_SCHEMA`

## Как применять переменные
Сначала авторизация:

```bash
railway login
```

Потом линкуем директорию к Railway project:

```bash
railway link
```

Дальше применяем переменные по сервисам.

### Planner app
```bash
cp ops/railway/env/planner-app.env.example /tmp/planner-app.env
# отредактируй значения
scripts/railway/apply-service-vars.sh publish_planner /tmp/planner-app.env
```

### Planner MCP
```bash
cp ops/railway/env/planner-mcp.env.example /tmp/planner-mcp.env
# отредактируй значения
scripts/railway/apply-service-vars.sh planner-mcp /tmp/planner-mcp.env
```

### Parser API
```bash
cp ops/railway/env/parser-api.env.example /tmp/parser-api.env
# отредактируй значения
scripts/railway/apply-service-vars.sh "Parser API" /tmp/parser-api.env
```

### Worker
```bash
cp ops/railway/env/parser-worker.env.example /tmp/parser-worker.env
# отредактируй значения
scripts/railway/apply-service-vars.sh Worker /tmp/parser-worker.env
```

### Scheduler
```bash
cp ops/railway/env/parser-scheduler.env.example /tmp/parser-scheduler.env
# отредактируй значения
scripts/railway/apply-service-vars.sh Scheduler /tmp/parser-scheduler.env
```

## Как применять домены
Примеры:

```bash
scripts/railway/apply-domain.sh publish_planner app.example.com 3000
scripts/railway/apply-domain.sh planner-mcp mcp.ba-post-planner.example.com 8080
```

Если нужен railway-generated domain:

```bash
railway domain --service planner-mcp --json
```

## Как применять deploy config
Важно:
- `railway.json`/`railway.toml` в Railway применяется как config текущего сервиса/репозитория
- так как у вас несколько сервисов и даже две репы, эти файлы лежат как templates

Практика такая:
1. для `Ba_post_planner` копируете нужный config в корень repo перед привязкой конкретного сервиса
2. для `reddit-parser` аналогично копируете соответствующий template во вторую репу

Для `publish_planner`:

```bash
cp ops/railway/planner-app.railway.json railway.json
```

Для `planner-mcp`:

```bash
cp ops/railway/planner-mcp.railway.json railway.json
```

Для `reddit-parser` templates из этого repo служат как reference, их нужно скопировать уже в репу `reddit-parser`.

## Post-deploy smoke
После деплоя:

```bash
scripts/railway/post-deploy-smoke.sh \
  "https://mcp.ba-post-planner.example.com/mcp" \
  "<MCP_AUTH_TOKEN>" \
  1 \
  123 \
  "https://parser-api.ba-post-planner.example.com"
```

## Что я уже проверил локально
- Railway CLI установлен
- версия CLI: `4.6.3`
- но текущая сессия не авторизована:
  - `railway status` -> `Unauthorized. Please login with railway login`

Это значит:
- automation-слой готов
- применять его в проект я смогу сразу после `railway login`
