# PanovaPRO — сайт фитнес-коучинга

Самостоятельный проект на **React + TanStack Start + Supabase**.
Лендинг, личный кабинет клиента и админка тренера.

## Быстрый старт на своём компьютере

1. Установите [Node.js 22+](https://nodejs.org/) (LTS, галочку «Add to PATH» оставьте).
2. Откройте папку проекта в терминале.
3. Скопируйте настройки:

```bash
copy .env.example .env
```

4. Откройте `.env` и вставьте ключи из [Supabase](https://supabase.com/dashboard) → ваш проект → **Project Settings → API**.
5. Скачайте видео упражнений (один раз, ~400 МБ):

```bash
npm run assets:fetch
```

6. Установите зависимости и запустите:

```bash
npm install
npm run dev
```

7. Откройте в браузере адрес из терминала (обычно `http://localhost:3000`).

### Полезные команды

| Команда | Что делает |
|---|---|
| `npm run assets:fetch` | Скачать видео упражнений в `public/__l5e` |
| `npm run dev` | Режим разработки |
| `npm run build` | Сборка для продакшена |
| `npm start` | Запуск собранного сайта |
| `npm run lint` | Проверка кода |

---

## План для чайников: как открыть сайт клиентам

Сайт состоит из двух частей:

1. **Фронтенд** (этот репозиторий) — страницы, формы, кабинет.
2. **База данных Supabase** — аккаунты, анкеты, программы, питание.

Без ключей Supabase в `.env` / на хостинге сайт не заработает.

### Шаг 1. Проверьте Supabase (5–10 минут)

1. Зайдите на [supabase.com/dashboard](https://supabase.com/dashboard).
2. Откройте проект (ID уже есть в `.env.example` / старом `.env`).
3. Убедитесь, что миграции из папки `supabase/migrations` применены (обычно уже есть, если сайт раньше работал в Lovable).
4. Скопируйте:
   - **Project URL** → `VITE_SUPABASE_URL` и `SUPABASE_URL`
   - **Publishable / anon key** → `VITE_SUPABASE_PUBLISHABLE_KEY` и `SUPABASE_PUBLISHABLE_KEY`
   - **Service role / secret key** → только `SUPABASE_SERVICE_ROLE_KEY` (нужен для админки: смена пароля, удаление клиента и т.п.)

> Service role — секрет. Его нельзя светить в GitHub и в браузере.

5. В **Authentication → URL Configuration** добавьте адреса сайта:
   - Site URL: ваш будущий домен, например `https://panovapro.ru`
   - Redirect URLs: `https://ваш-домен/**` и для локалки `http://localhost:3000/**`

### Шаг 2. Выложите сайт на Timeweb Cloud

Подробная инструкция: [deploy/TIMEWEB.md](./deploy/TIMEWEB.md).

Кратко:

1. Зарегистрируйтесь на [timeweb.cloud](https://timeweb.cloud/) и создайте **облачный сервер** (Ubuntu, от 2 GB RAM).
2. По SSH установите Node.js 22, Nginx, PM2.
3. Склонируйте проект, создайте `.env`, выполните:

```bash
npm install
npm run assets:fetch
npm run build
pm2 start ecosystem.config.cjs
```

4. Настройте Nginx (файл `deploy/nginx-panovapro.conf`) и SSL через `certbot`.
5. Привяжите домен к IP сервера в панели Timeweb.
6. В Supabase укажите `https://ваш-домен` в Auth URL Configuration.

База клиентов/программ по-прежнему в Supabase — на Timeweb крутится только сайт.

### Шаг 3. Проверка перед клиентами (чек-лист)

- [ ] Открывается главная страница
- [ ] Регистрация / вход на `/auth` работают
- [ ] Клиент заполняет анкету и видит статус «ожидает одобрения»
- [ ] Тренер (админ) видит клиента в `/admin` и может открыть доступ
- [ ] Сброс пароля приходит на почту (в Supabase включите Email Auth / SMTP при необходимости)
- [ ] В Auth → URL Configuration указан ваш продакшен-домен

### Шаг 4. Безопасность (обязательно один раз)

Файл `.env` раньше мог попасть в Git. Сделайте так:

1. Убедитесь, что `.env` в `.gitignore` (уже сделано).
2. При коммите уберите `.env` из репозитория: `git rm --cached .env`
3. Публичный (anon/publishable) ключ можно оставить — защиту даёт RLS.
4. Если когда-либо светили **service_role** в GitHub — в Supabase сразу **перевыпустите** ключ.

---

## Структура проекта (кратко)

- `src/routes/` — страницы (лендинг, auth, dashboard, admin)
- `src/components/` — UI и блоки лендинга/кабинета
- `src/integrations/supabase/` — подключение к базе
- `supabase/migrations/` — схема базы данных

## Деплой: пресет Nitro

По умолчанию сборка идёт под Node (`node-server`) — это как раз то, что нужно для Timeweb VDS и команды `npm start` / PM2.

```bash
npm run build
npm start
# или: pm2 start ecosystem.config.cjs
```