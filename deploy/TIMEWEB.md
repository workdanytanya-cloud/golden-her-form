# Деплой на Timeweb Cloud

Сайт — Node.js-приложение (TanStack Start + Nitro). На [Timeweb Cloud](https://timeweb.cloud/) его удобно держать на **облачном сервере (VDS)**.

База данных остаётся в **Supabase** — на сервере Timeweb крутится только сайт.

---

## Что понадобится

- Аккаунт на [timeweb.cloud](https://timeweb.cloud/)
- Домен (можно купить у Timeweb или привязать свой)
- Ключи из Supabase (см. `.env.example`)
- На компьютере: Git + Node.js 22+ (для проверки локально)

Рекомендуемый минимум сервера: **2 GB RAM**, **2 vCPU**, диск **от 20 GB** (видео упражнений ~400 МБ + сборка).

---

## Шаг 1. Создайте сервер

1. Войдите в панель Timeweb Cloud → **Облачные серверы** → **Создать**.
2. ОС: **Ubuntu 24.04** (или 22.04).
3. Регион: Россия (если клиенты из РФ).
4. Создайте сервер и сохраните:
   - публичный IP
   - логин/пароль root (или SSH-ключ)

---

## Шаг 2. Подключитесь по SSH

На Windows удобно **PowerShell** или терминал в Cursor:

```bash
ssh root@ВАШ_IP
```

---

## Шаг 3. Установите Node.js 22, Nginx, PM2

На сервере выполните:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx git
npm install -g pm2
node -v   # должно быть v22.x
```

---

## Шаг 4. Залейте проект

Вариант А — с GitHub:

```bash
cd /var/www
git clone https://github.com/workdanytanya-cloud/golden-her-form.git panovapro
cd panovapro
```

Вариант Б — залить папку с компьютера (SCP/SFTP), если репозиторий приватный.

Создайте `.env` на сервере:

```bash
nano /var/www/panovapro/.env
```

Вставьте все переменные из `.env.example` + реальный `SUPABASE_SERVICE_ROLE_KEY`.

Сохраните: `Ctrl+O`, Enter, `Ctrl+X`.

---

## Шаг 5. Соберите и запустите сайт

```bash
cd /var/www/panovapro
npm install
npm run assets:fetch
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Сайт слушает порт **3000** внутри сервера. Снаружи его закроет Nginx.

Проверка:

```bash
curl -I http://127.0.0.1:3000
```

Должен ответить `200`.

---

## Шаг 6. Nginx + HTTPS

Скопируйте конфиг:

```bash
cp deploy/nginx-panovapro.conf /etc/nginx/sites-available/panovapro
ln -sf /etc/nginx/sites-available/panovapro /etc/nginx/sites-enabled/panovapro
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

В файле `deploy/nginx-panovapro.conf` замените `ВАШ_ДОМЕН.ru` на реальный домен.

### Домен в Timeweb

1. В панели Timeweb привяжите домен к IP сервера (A-запись → IP).
2. Подождите 5–30 минут (иногда дольше), пока DNS обновится.
3. Выпустите бесплатный SSL (Let's Encrypt):

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ВАШ_ДОМЕН.ru -d www.ВАШ_ДОМЕН.ru
```

После этого сайт откроется по `https://ВАШ_ДОМЕН.ru`.

---

## Шаг 7. Supabase Auth

В Supabase → **Authentication → URL Configuration**:

- Site URL: `https://ВАШ_ДОМЕН.ru`
- Redirect URLs: `https://ВАШ_ДОМЕН.ru/**`

---

## Обновление сайта после правок кода

```bash
cd /var/www/panovapro
git pull
npm install
npm run assets:fetch   # только если появились новые видео
npm run build
pm2 restart panovapro
```

---

## Частые проблемы

| Проблема | Что сделать |
|---|---|
| 502 Bad Gateway | `pm2 status` — процесс упал? Смотрите `pm2 logs panovapro` |
| Нет видео упражнений | `npm run assets:fetch`, затем `npm run build` и `pm2 restart panovapro` |
| Админка не меняет пароль | В `.env` нет `SUPABASE_SERVICE_ROLE_KEY` |
| Логин не редиректит | В Supabase не указан продакшен-домен в Redirect URLs |
| Порт занят | `pm2 delete panovapro` и снова `pm2 start ecosystem.config.cjs` |

---

## Альтернатива внутри Timeweb

Если позже захотите упростить хранение видео — можно вынести ролики в **S3 Timeweb Cloud** и обновить URL в таблице `exercises`. Пока достаточно раздачи из `public/__l5e` на том же сервере.
