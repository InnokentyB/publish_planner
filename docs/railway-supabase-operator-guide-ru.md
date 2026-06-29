# Railway + Supabase Operator Guide

## Что это за документ
Это единая практическая инструкция для оператора, который руками проводит:
- cutover planner-таблиц из `public` в `planner`
- последующий деплой `Ba_post_planner`
- подготовку и rollout `reddit-parser` в схему `parser`

Документ написан в формате:
- куда зайти
- куда нажать
- что вставить
- что должно получиться

## Что будет в итоге
После прохождения этого runbook:

1. `Ba_post_planner` работает с таблицами в схеме `planner`
2. схема `parser` создана
3. `reddit-parser` готовится или уже работает в схеме `parser`
4. Railway-сервисы разведены по ролям

## Какие сервисы считаем целевыми

### Из `Ba_post_planner`
- `planner-app`
- `planner-mcp`

### Из `reddit-parser`
- `reddit-parser-api`
- `reddit-parser-worker`
- `reddit-parser-scheduler`

## Часть 1. Что открыть заранее

Перед началом открой в браузере:

1. Railway project
2. Supabase project
3. GitHub репозиторий `Ba_post_planner`
4. GitHub репозиторий `reddit-parser`

Также открой локально эти файлы:

- [production-cutover-checklist-ru.md](/Users/innokentyb/Ba_post_planner/docs/production-cutover-checklist-ru.md)
- [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
- [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
- [dual-schema-cutover-rollback.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-rollback.sql)

## Часть 2. Подготовка Railway

### Рекомендуемый production template
Чтобы потом не было путаницы между сервисами, доменами и клиентскими конфигами, лучше заранее зафиксировать такие значения:

- Railway service для MCP: `planner-mcp`
- Public URL для MCP: `https://mcp.ba-post-planner.<your-domain>`
- MCP endpoint: `https://mcp.ba-post-planner.<your-domain>/mcp`
- MCP health: `https://mcp.ba-post-planner.<your-domain>/health`
- Имя коннектора в Claude/Cline: `ba-post-planner-prod`
- Railway secret для MCP: `MCP_AUTH_TOKEN`
- Локальный alias для хранения того же секрета: `BA_POST_PLANNER_MCP_AUTH_TOKEN`

Для parser:
- Railway service: `reddit-parser-api`
- internal URL: `http://reddit-parser-api.railway.internal:<port>`
- public URL, если вообще нужен: `https://parser-api.ba-post-planner.<your-domain>`
- secret: `PARSER_SERVICE_TOKEN`

Если custom domain пока нет:
- используй Railway public URL
- но имя коннектора все равно оставь `ba-post-planner-prod`

### Шаг 1. Найти все нужные services
В Railway:

1. Открой нужный `Project`
2. На главном экране посмотри список services
3. Убедись, что видишь:
   - `planner-app`
   - `planner-mcp`
4. Если parser stack уже создан, найди:
   - `reddit-parser-api`
   - `reddit-parser-worker`
   - `reddit-parser-scheduler`

Если parser services еще не созданы:
- это нормально
- planner cutover можно делать раньше parser rollout

### Шаг 2. Зафиксировать, какие services будут остановлены
Для окна миграции останови минимум:

- `planner-app`
- `planner-mcp`

Опционально для совсем чистого окна:
- `reddit-parser-api`
- `reddit-parser-worker`
- `reddit-parser-scheduler`

## Часть 3. Backup в Supabase

### Шаг 3. Открыть Supabase
В Supabase:

1. Открой нужный project
2. В левом меню открой:
   - `SQL Editor`
3. Отдельно проверь, где у вас делаются backups / snapshots

### Шаг 4. Сделать backup
Если на вашем тарифе доступен штатный backup:

1. Создай backup / snapshot
2. Дождись подтверждения, что он завершен

Если штатного backup UI нет:
- не начинай cutover без понимания, как вы откатываете БД

## Часть 4. Окно миграции для planner

### Шаг 5. Остановить `planner-app`
В Railway:

1. Открой service `planner-app`
2. Перейди в `Deployments`
3. Нажми `Stop` или отключи active deployment, если у вас такой сценарий в UI
4. Убедись по логам, что service остановился

Что важно:
- после этого никто не должен писать в planner tables

### Шаг 6. Остановить `planner-mcp`
В Railway:

1. Открой service `planner-mcp`
2. Перейди в `Deployments`
3. Останови active deployment
4. Убедись, что сервис не принимает запросы

### Шаг 7. Выполнить cutover SQL
В Supabase:

1. Открой `SQL Editor`
2. Создай новый query
3. Вставь содержимое:
   - [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
4. Нажми `Run`

Что должно произойти:
- создадутся схемы `planner` и `parser`
- planner-таблицы переедут из `public` в `planner`

### Шаг 8. Выполнить verify SQL
В Supabase:

1. Создай новый query
2. Вставь содержимое:
   - [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
3. Нажми `Run`

Нужно проверить результат:

1. В `planner` есть planner-таблицы
2. `parser` schema существует
3. В `public` нет planner-таблиц
4. `_prisma_migrations` осталась в `public`

Если это не так:
- не поднимай сервисы
- сначала исправь состояние БД

## Часть 5. Настройка env для `Ba_post_planner`

### Шаг 9. Обновить env у `planner-app`
В Railway:

1. Открой service `planner-app`
2. Перейди во вкладку `Variables`
3. Убедись, что выставлены:
   - `APP_DATABASE_URL`
   - `APP_DIRECT_DATABASE_URL`
   - `APP_DB_SCHEMA=planner`
   - `APP_TARGET_DB_SCHEMA=planner`
4. Если parser integration уже будете поднимать, проверь еще:
   - `PARSER_API_BASE_URL`
   - `PARSER_SERVICE_TOKEN`

На переходный период также оставь compatibility aliases:
- `DATABASE_URL=<same as APP_DATABASE_URL>`
- `DIRECT_DATABASE_URL=<same as APP_DIRECT_DATABASE_URL>`
- `PLANNER_DB_SCHEMA=planner`
- `PLANNER_TARGET_SCHEMA=planner`

Важно:
- `APP_DATABASE_URL` не надо переписывать так, чтобы там default schema стала `planner`
- пусть connection string остается обычным

### Шаг 10. Обновить env у `planner-mcp`
В Railway:

1. Открой service `planner-mcp`
2. Перейди во вкладку `Variables`
3. Убедись, что есть:
   - `APP_DATABASE_URL`
   - `APP_DB_SCHEMA=planner`
   - `MCP_AUTH_TOKEN`
4. Если `planner-mcp` будет ходить в parser:
   - `PARSER_API_BASE_URL`
   - `PARSER_SERVICE_TOKEN`

На переходный период также оставь:
- `DATABASE_URL=<same as APP_DATABASE_URL>`
- `PLANNER_DB_SCHEMA=planner`

## Часть 6. Деплой `Ba_post_planner`

### Шаг 11. Поднять `planner-app`
В Railway:

1. Открой service `planner-app`
2. Убедись, что выбран новый deploy с текущей веткой
3. Запусти deploy
4. Проверь start command:
   - `npm run migrate:deploy && node dist/server.js`

Что должно случиться:
- сервис стартует
- Prisma подключается к БД
- planner начинает читать и писать в `planner`

### Шаг 12. Проверить `planner-app`
После старта:

1. Открой public URL `planner-app`
2. Проверь, что UI грузится
3. Открой health endpoint:
   - `/api/health`
4. Проверь:
   - логин работает
   - список проектов открывается
   - страницы проекта открываются

Если есть ошибка вида:
- `relation does not exist`
- `table not found`
- `permission denied for schema planner`

Тогда:
- не поднимай `planner-mcp`
- иди в rollback или исправление БД/env

### Шаг 13. Поднять `planner-mcp`
В Railway:

1. Открой service `planner-mcp`
2. Запусти deploy
3. Убедись, что этот service не запускает миграции
4. Проверь health endpoint, когда remote MCP entrypoint будет готов

### Шаг 14. Smoke после planner cutover
Проверь:

1. чтение проектов
2. чтение publication tasks
3. импорт publication plan
4. чтение asset/ref
5. read-only MCP tool

Только после этого открывай доступ пользователям обратно.

## Часть 7. Rollback planner

### Когда откатываться
Откатываемся, если:

1. `planner-app` не стартует
2. Prisma не видит таблицы
3. проектные страницы не работают
4. записи не создаются

### Как откатиться
В Railway:

1. Останови `planner-app`
2. Останови `planner-mcp`

В Supabase:

1. Открой `SQL Editor`
2. Создай новый query
3. Вставь:
   - [dual-schema-cutover-rollback.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-rollback.sql)
4. Нажми `Run`

Потом в Railway:

1. Верни предыдущий deploy
2. Если нужно, верни прежние env assumptions

## Часть 8. Подготовка `reddit-parser`

Ниже шаги именно для второй репы.

Важно:
- в текущем репозитории мы только создали схему `parser`
- сами parser-таблицы должны создаваться второй репой

## Часть 9. Что сделать во второй репе до деплоя

### Шаг 15. Привести parser repo к schema-aware режиму
Во второй репе `reddit-parser` нужно сделать:

1. все SQLAlchemy models должны жить в `parser`
2. миграции должны создавать таблицы в `parser`
3. repo должен понимать env:
   - `APP_DATABASE_URL`
   - `PARSER_DB_SCHEMA=parser`
4. parser API должен иметь service auth:
   - `PARSER_SERVICE_TOKEN`

Если это еще не сделано:
- не поднимай parser в прод

## Часть 10. Создание parser services в Railway

### Шаг 16. Создать `reddit-parser-api`
В Railway:

1. Нажми `New Service`
2. Выбери deploy из GitHub repo `reddit-parser`
3. Назови service:
   - `reddit-parser-api`
4. В `Variables` добавь:
   - `APP_DATABASE_URL=<ваш supabase url>`
   - `APP_DB_SCHEMA=parser`
   - `PARSER_DB_SCHEMA=parser`
   - `PARSER_SERVICE_TOKEN=<секрет>`
   - `PORT`
   - `REDDIT_PROVIDER`
   - `REDDIT_CLIENT_ID`
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_USER_AGENT`
5. В build/start настрой:
   - build: `pip install -r requirements.txt`
   - start: `./bin/start api`

### Шаг 17. Создать `reddit-parser-worker`
В Railway:

1. Создай еще один service из той же репы
2. Назови:
   - `reddit-parser-worker`
3. Добавь variables:
   - `APP_DATABASE_URL`
   - `APP_DB_SCHEMA=parser`
   - `PARSER_DB_SCHEMA=parser`
   - `PARSER_SERVICE_TOKEN`
   - `REDDIT_PROVIDER`
   - Reddit credentials
4. Build:
   - `pip install -r requirements.txt`
5. Start:
   - `./bin/start worker`

### Шаг 18. Создать `reddit-parser-scheduler`
В Railway:

1. Создай еще один service из той же репы
2. Назови:
   - `reddit-parser-scheduler`
3. Добавь variables:
   - `APP_DATABASE_URL`
   - `APP_DB_SCHEMA=parser`
   - `PARSER_DB_SCHEMA=parser`
   - `PARSER_SERVICE_TOKEN`
4. Build:
   - `pip install -r requirements.txt`
5. Start:
   - `./bin/start scheduler`

## Часть 11. Деплой parser stack

### Шаг 19. Сначала поднять `reddit-parser-api`
Почему так:
- именно API service должен первым создать/проверить схему и миграции

Порядок:

1. Задеплой `reddit-parser-api`
2. Посмотри логи
3. Убедись, что он:
   - подключился к БД
   - использует `parser`
   - не пытается писать в `public`

### Шаг 20. Проверить parser API
После старта:

1. Открой health endpoint parser API
2. Убедись, что он отвечает
3. Если в repo есть docs/openapi route, проверь и его

### Шаг 21. Поднять `reddit-parser-worker`
После успешного API:

1. Задеплой `reddit-parser-worker`
2. Убедись по логам, что worker стартовал без ошибок
3. Проверь, что он видит БД и нужные env

### Шаг 22. Поднять `reddit-parser-scheduler`
После worker:

1. Задеплой `reddit-parser-scheduler`
2. Убедись, что scheduler стартовал
3. Проверь, что он не падает на доступе к БД

## Часть 12. Проверка parser stack

### Шаг 23. Smoke для parser
Проверь:

1. `/health` у parser API
2. доступность auth
3. пробный parser job
4. чтение шаблонов или insights, если уже реализовано

Если parser API не стартует:
- не поднимай worker/scheduler дальше
- сначала исправь API и миграции

### Шаг 23A. Быстрая ручная проверка parser API в Railway
В Railway:

1. Открой service `reddit-parser-api`
2. Перейди в `Settings` или `Networking`
3. Скопируй public URL service
4. Открой его в браузере с путем `/health`

Что должно получиться:
- endpoint отвечает без 5xx
- в логах `reddit-parser-api` нет ошибок подключения к БД

Если `/health` не открывается:
- проверь, что service действительно задеплоен
- проверь `PORT`
- проверь start command
- проверь логи на ошибку подключения к Supabase

### Шаг 23B. Прогнать автоматический parser smoke локально против Railway
Из корня `Ba_post_planner` локально запусти:

```bash
PARSER_API_BASE_URL="https://<reddit-parser-api>.up.railway.app" \
PARSER_SERVICE_TOKEN="<parser service token>" \
DATABASE_URL="<planner database url>" \
node scripts/test_parser_chain.js \
  --user-id 1 \
  --project-id 123 \
  --query "course creation pain points" \
  --subreddits "onlinecourses,Entrepreneur" \
  --limit 10
```

Что делает этот скрипт:
1. проверяет прямой `GET /health` у parser API
2. поднимает локальный MCP client к [server.js](/Users/innokentyb/Ba_post_planner/dist/mcp/server.js)
3. вызывает `ba_parser_health`
4. вызывает `ba_parser_list_templates`
5. если передан `--query`, создает пробный parser search job и читает его статус

Что важно перед запуском:
1. сначала собери backend:

```bash
npm run build:backend
```

2. `userId` должен существовать в planner БД
3. `projectId` должен существовать и быть доступен этому пользователю
4. если parser auth включен, `PARSER_SERVICE_TOKEN` должен совпадать с токеном у `reddit-parser-api`

### Шаг 23C. Как читать результат parser smoke
Успех:
- exit code `0`
- в выводе есть успешные шаги:
  - direct parser `/health`
  - `ba_parser_health`
  - `ba_parser_list_templates`

Если скрипт падает:
- exit `5`: parser API недоступен напрямую
- exit `6`: planner не смог пройти health flow до parser
- exit `7`: planner дошел до parser, но не смог получить templates
- exit `8`: не создался test search job
- exit `9`: job создался, но не читается его статус

Практическая интерпретация:
- `5` значит проблема почти наверняка в `reddit-parser-api` или его Railway env
- `6` значит parser API может жить, но planner env или service token настроены неправильно
- `7-9` обычно означают, что базовая связка уже есть, а проблема в parser business flow, workspace routing или данных

### Шаг 23D. Если нужен только быстрый health-check без search job
Запусти parser smoke без создания тестовой задачи:

```bash
PARSER_API_BASE_URL="https://<reddit-parser-api>.up.railway.app" \
PARSER_SERVICE_TOKEN="<parser service token>" \
DATABASE_URL="<planner database url>" \
node scripts/test_parser_chain.js \
  --user-id 1 \
  --project-id 123 \
  --skip-search
```

Это хороший вариант для первого post-deploy smoke, когда еще не хочется плодить тестовые search jobs.

## Часть 13. Финальная связка planner + parser

### Шаг 24. Связать planner с parser
Когда parser API уже стабилен:

В Railway для `planner-app`:
- `PARSER_API_BASE_URL=<url или internal url parser api>`
- `PARSER_SERVICE_TOKEN=<тот же сервисный токен>`

В Railway для `planner-mcp`:
- `PARSER_API_BASE_URL=<url или internal url parser api>`
- `PARSER_SERVICE_TOKEN=<тот же сервисный токен>`

Если используете Railway private networking:
- лучше использовать internal hostname parser service

### Шаг 25. Финальный интеграционный smoke
После этого проверить:

1. planner-app жив
2. planner-mcp жив
3. parser API жив
4. planner может обратиться к parser
5. MCP может вызвать parser-ориентированный tool

Рекомендуемый порядок:
1. Открыть `planner-app` и убедиться, что UI жив
2. Проверить `planner-app /api/health`
3. Прогнать [test_parser_chain.js](/Users/innokentyb/Ba_post_planner/scripts/test_parser_chain.js) с `--skip-search`
4. Затем прогнать полный parser smoke с `--query`
5. Только после этого возвращать систему пользователям

## Самый короткий порядок действий

1. Остановить `planner-app` и `planner-mcp`
2. Сделать backup в Supabase
3. Выполнить [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
4. Выполнить [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
5. Выставить planner env в Railway
6. Поднять `planner-app`
7. Проверить app и health
8. Поднять `planner-mcp`
9. Подготовить `reddit-parser` к `parser` schema
10. Создать `reddit-parser-api`
11. Создать `reddit-parser-worker`
12. Создать `reddit-parser-scheduler`
13. Поднять parser API
14. Поднять worker и scheduler
15. Связать planner env с parser API
16. Прогнать smoke

## Связанные документы
- [production-cutover-checklist-ru.md](/Users/innokentyb/Ba_post_planner/docs/production-cutover-checklist-ru.md)
- [migration-plan.md](/Users/innokentyb/Ba_post_planner/docs/migration-plan.md)
- [schema-plan.md](/Users/innokentyb/Ba_post_planner/docs/schema-plan.md)
- [railway-deployment-runbook.md](/Users/innokentyb/Ba_post_planner/docs/railway-deployment-runbook.md)
