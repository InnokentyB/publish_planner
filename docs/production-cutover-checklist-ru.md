# Чеклист Продового Cutover На `planner` / `parser`

## Что это за документ
Это пошаговая инструкция для окна миграции, когда мы:
- переносим таблицы `Ba_post_planner` из `public` в `planner`
- заранее создаем схему `parser`
- потом поднимаем сервисы обратно уже с новой схемой planner

Документ рассчитан на ручное выполнение в:
- Railway
- Supabase SQL Editor

## Что должно быть готово заранее
Перед началом окна миграции должно быть выполнено:

1. В Railway уже подготовлен новый deploy этого репозитория с текущей веткой.
2. В Supabase у тебя есть доступ в SQL Editor.
3. У тебя под рукой есть эти файлы:
   - [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
   - [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
   - [dual-schema-cutover-rollback.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-rollback.sql)
4. Ты понимаешь, какой Railway service сейчас отвечает за:
   - `planner-app`
   - `planner-mcp`
   - если уже есть parser stack, то еще:
     - `reddit-parser-api`
     - `reddit-parser-worker`
     - `reddit-parser-scheduler`

## Что важно понять до старта
Во время окна миграции:
- пользователи не должны работать в системе
- `planner-app` не должен писать в БД
- `planner-mcp` не должен писать в БД
- любые worker-like процессы этого репозитория не должны писать в БД

Причина:
- иначе можно получить запись части данных в `public`, а части уже в `planner`

## План окна миграции

### Этап 0. Зафиксировать окно
Сделай это перед техническими шагами:

1. Сообщи пользователям, что сервис недоступен на время миграции.
2. Убедись, что никто не работает через Claude/MCP.
3. Убедись, что никто не импортирует publication plans и не публикует контент.

### Этап 1. Остановить запись в БД
В Railway:

1. Открой service `planner-app`.
2. Открой service `planner-mcp`.
3. Если есть отдельные процессы этого репозитория, которые могут писать в planner БД, тоже останови их.

Практическая цель:
- после этого в БД не должно появляться новых planner-записей

Если parser stack уже развернут:
- его можно не трогать, если он еще не пишет в `planner`
- но если хочешь максимально чистое окно, можно временно остановить и parser services тоже

### Этап 2. Сделать backup
Минимально рекомендуется:

1. Создать backup в Supabase перед изменением схем.
2. Если backup делается не мгновенно, дождаться подтверждения, что он доступен.

Если полноценный backup сейчас неудобен:
- хотя бы не начинай cutover без понимания rollback-пути

## SQL шаги в Supabase

### Этап 3. Выполнить основной cutover SQL
Открой Supabase SQL Editor и выполни:

- [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)

Что делает этот SQL:
- создает схемы `planner` и `parser`, если их еще нет
- переносит planner-таблицы из `public` в `planner`
- не трогает `_prisma_migrations`

Что важно:
- `_prisma_migrations` должен остаться в `public`
- это ожидаемое и правильное поведение

### Этап 4. Выполнить verify SQL
Сразу после основного SQL выполни:

- [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)

Что ты должен увидеть:

1. В схеме `planner` есть planner-таблицы.
2. Схема `parser` существует.
3. В `public` больше нет planner-таблиц.
4. В `public` осталась `_prisma_migrations`.

Если verify показывает, что planner-таблицы все еще частично в `public`:
- не поднимай сервисы
- сначала разберись с причиной

## Railway шаги после SQL

### Этап 5. Обновить переменные окружения planner services
В Railway для `planner-app`:

должны быть выставлены:
- `PLANNER_DB_SCHEMA=planner`
- `PLANNER_TARGET_SCHEMA=planner`

Также проверь:
- `DATABASE_URL` указывает на вашу Supabase БД

Важно:
- не нужно менять `DATABASE_URL` так, чтобы default schema стала `planner`
- пусть default schema остается `public`

Почему:
- Prisma-модели уже явно смотрят в `planner`
- `_prisma_migrations` остается в `public`

В Railway для `planner-mcp`:

должно быть:
- `PLANNER_DB_SCHEMA=planner`

Если планируешь позже поднимать parser stack:
- для parser services выставляй `PARSER_DB_SCHEMA=parser`

### Этап 6. Поднять `planner-app`
После обновления env:

1. Задеплой `planner-app` с этой веткой.
2. Убедись, что стартовая команда:
   - `npm run migrate:deploy && node dist/server.js`
3. Дождись успешного старта.

Что должно произойти:
- Prisma подключится к БД
- увидит `_prisma_migrations`
- приложение начнет работать уже с таблицами в `planner`

### Этап 7. Проверить `planner-app`
После старта проверь:

1. Главная страница открывается.
2. Работает health endpoint:
   - `/api/health`
3. В health видно, что planner runtime schema теперь `planner`.
4. Логин работает.
5. Список проектов открывается.
6. Открывается экран проекта.
7. Читаются `content_items`, `social_channels`, `project_settings`.

Если на этом этапе есть ошибка вида:
- relation does not exist
- table not found
- permission denied on schema planner

Тогда:
- не поднимай `planner-mcp`
- сначала исправь проблему на уровне БД или env

### Этап 8. Поднять `planner-mcp`
Только после успешной проверки `planner-app`:

1. Задеплой `planner-mcp`
2. Убедись, что он не гоняет миграции
3. Проверь:
   - `/health`
   - базовый список tools

Если `planner-mcp` использует те же planner tables, он должен уже читать их из `planner`

## Проверки после запуска

### Этап 9. Smoke checklist
Проверь руками:

1. Чтение проектов.
2. Чтение publication tasks.
3. Импорт publication plan.
4. Чтение assets/ref из publication plan.
5. Один безопасный read-only MCP вызов.

Если хочешь аккуратнее:
- сначала read-only smoke
- потом один write smoke

### Этап 10. Разморозить пользователей
Только после успешного smoke:

1. Разреши вход пользователям обратно.
2. Разреши работу через Claude/MCP.
3. Следи за логами первые 15-30 минут.

## Когда делать rollback
Rollback нужен, если после cutover SQL и деплоя:

1. `planner-app` не стартует
2. Prisma падает на старте
3. основные таблицы не читаются
4. приложение пишет не туда
5. критичные user flows не работают

## Как делать rollback

### Вариант rollback
1. Останови `planner-app`
2. Останови `planner-mcp`
3. В Supabase SQL Editor выполни:
   - [dual-schema-cutover-rollback.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-rollback.sql)
4. Верни предыдущий deploy приложения
5. Убедись, что env больше не требует `planner` runtime

После rollback:
- planner-таблицы снова будут в `public`

## Что делать с parser
В этом окне мы:
- создаем схему `parser`
- но не мигрируем туда parser-таблицы из второй репы автоматически этим SQL

То есть parser часть идет следующим отдельным шагом:

1. во второй репе сделать schema-aware migrations для `parser`
2. задеплоить `reddit-parser-api`
3. выполнить parser migrations
4. потом поднять worker и scheduler

## Самый короткий рабочий сценарий
Если совсем коротко, то порядок такой:

1. Остановить `planner-app` и `planner-mcp`
2. Сделать backup
3. Выполнить [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
4. Выполнить [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
5. В Railway выставить `PLANNER_DB_SCHEMA=planner`
6. Задеплоить `planner-app`
7. Проверить `/api/health` и основные экраны
8. Задеплоить `planner-mcp`
9. Прогнать smoke
10. Открыть доступ пользователям

## Связанные документы
- [migration-plan.md](/Users/innokentyb/Ba_post_planner/docs/migration-plan.md)
- [schema-plan.md](/Users/innokentyb/Ba_post_planner/docs/schema-plan.md)
- [railway-deployment-runbook.md](/Users/innokentyb/Ba_post_planner/docs/railway-deployment-runbook.md)
