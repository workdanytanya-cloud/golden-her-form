# Миграция PanovaPRO на self-hosted инфраструктуру

Этот документ описывает **целевую** схему. На текущем этапе приложение **ещё зависит от Supabase** (Auth, PostgREST, Storage). Добавлены только:

- устойчивые ссылки на видео упражнений;
- PDF питания и тренировок из published snapshot;
- интерфейсы-границы `AuthProvider`, `DatabaseProvider`, `PublishedProgramRepository`, `ExerciseRepository`.

Не считать этот репозиторий независимым от Supabase, пока не появится `LocalPostgresProvider` и локальная авторизация.

## Целевая схема (Timeweb)

1. **Nginx** — TLS, reverse proxy на Node `:3000`.
2. **Существующий Node / TanStack Start** — тот же процесс PM2, без Chromium и Puppeteer.
3. **PostgreSQL 16** — на том же VPS или отдельном инстансе Timeweb.
4. **Локальная авторизация** — таблица `public.users` с теми же UUID, что в `auth.users`.
5. **Сессии** — httpOnly + `Secure` + `SameSite=Lax` cookie (не localStorage JWT).
6. **Пароли**:
   - проверка **bcrypt** для хешей, перенесённых из Supabase GoTrue;
   - **argon2id** для новых паролей и смен.
7. **Файлы** — только небольшие изображения (GIF техники, фото блюд) на диске VPS или Timeweb S3.
8. **Видео** — только внешние https-ссылки YouTube / Rutube / страница; файлы роликов на сервер не класть.
9. **Бэкапы PostgreSQL** — ежедневный `pg_dump -Fc`.
10. **Локальная ротация** — 7 суточных копий на отдельном volume.
11. **Вторая копия вне VPS** — S3 Timeweb / другой сервер / офлайн диск.
12. **Сборка приложения вне VPS** — `npm run build` на CI или рабочем ПК; на сервер попадает `.output`.
13. **Параллельный стенд** — новый домен/порт рядом с текущим сайтом на Supabase.
14. **Rollback** — DNS/Nginx обратно на старый Node+Supabase, пока dual-run не закрыт.

## Границы кода

| Интерфейс | Сейчас | Дальше |
|---|---|---|
| `AuthProvider` | `SupabaseAuthProvider` | `LocalAuthProvider` (cookie + argon2id/bcrypt) |
| `DatabaseProvider` | `SupabaseDatabaseProvider` | `LocalPostgresProvider` |
| `PublishedProgramRepository` | чтение assignment → published version через service role | тот же контракт на `pg` |
| `ExerciseRepository` | upsert с серверной нормализацией видео | без PostgREST |

Клиент по-прежнему не должен получать draft вместо published snapshot.

## Миграция данных

1. Дамп `auth.users` (id, email, encrypted_password) + все `public.*`.
2. Не переписывать `nutrition_plan_versions` / `training_program_versions`.
3. Не запускать seed, который трогает assignment клиентов.
4. SQL `20260913190000_exercise_video_fields.sql` применять только к новому Postgres, не к production Supabase автоматически.

## PDF

Генерация только из active assignment → `status = published`. Каталоги `recipes` / `exercises` в момент скачивания не используются.
