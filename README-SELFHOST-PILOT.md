# Self-hosted клиентский контур (многопользовательский)

Это не кабинет одного человека. PostgreSQL, сессии и импорт рассчитаны на всех текущих и будущих клиентов. Первый реальный smoke-тест можно сделать на любом экспорте (например, после выгрузки данных клиентки). Данные конкретных людей в репозиторий не входят.

## Требования

- Node.js **>= 22.12** (в `.nvmrc` указан 22.14.0 LTS).
- Docker Desktop — только для локального PostgreSQL.

### Windows + nvm-windows

Глобальную Node 20 не меняйте самовольно, если ею пользуются другие проекты.

```bat
nvm install 22.14.0
nvm use 22.14.0
node -v
```

Должно быть `v22.14.0` или новее в линейке 22.x.

## PostgreSQL

Проверьте Docker: `docker version`. Если Docker Desktop выключен — не запускайте compose, сначала включите его.

```bat
copy .env.selfhost.example .env.selfhost
docker compose -f docker-compose.selfhost.yml up -d
npm run selfhost:migrate
```

Миграции **не** применяются при `npm run dev`. На production нужна отдельная команда:

```bat
set SELFHOST_MIGRATE_CONFIRM=APPLY
npm run selfhost:migrate
```

## Импорт клиентов

Поддерживается один JSON, каталог файлов или объект `{ "clients": [ ... ] }`.

```bat
npm run selfhost:import-client -- --file C:\exports\client.json
npm run selfhost:import-client -- --file C:\exports\clients --dry-run
```

Plaintext-пароль в JSON запрещён. Повторный импорт идемпотентен. При другом `content_hash` импорт останавливается и не трогает published snapshot.

Пароль задаётся отдельно (скрытый ввод, не аргумент CLI):

```bat
npm run selfhost:set-password -- --email client@example.com
```

## Запуск приложения

```bat
copy .env.selfhost.example .env
rem в .env: AUTH_BACKEND=local, DATA_BACKEND=postgres, DATABASE_URL=...
nvm use 22.14.0
npm run dev
```

Проверка живого процесса без персональных данных: `GET /api/selfhost/health`.

Клиентские маршруты: `/auth`, `/dashboard`, `/dashboard/nutrition`, `/dashboard/training`, PDF, logout.

В режиме `local` + `postgres` клиентский контур не ходит в Supabase Auth, PostgREST, Storage и Realtime. Если Postgres недоступен, будет ошибка, а не облако.

Тренерская админка в этом этапе не переносится.

## Видео

Опубликованные snapshots не переписываются. Ссылки живут в `exercise_media_bindings` (по `exercise_id`) и при необходимости в `snapshot_exercise_media_bindings` (явное подтверждение тренера, если в старом snapshot нет id). Файлы видео на VPS не загружаются.
