# Инструкция по настройке Railway + Telegram

## Шаг 1: Создание Telegram бота

1. Откройте Telegram и найдите [@BotFather](https://t.me/botfather)
2. Отправьте команду `/newbot`
3. Следуйте инструкциям:
   - Придумайте имя бота (например: "Meta Pay Support")
   - Придумайте username бота (например: "metapay_support_bot")
4. Скопируйте токен бота (выглядит как: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

## Шаг 2: Развертывание на Railway

### 2.1 Создание проекта

1. Перейдите на https://railway.com/
2. Войдите через GitHub
3. Нажмите "New Project"
4. Выберите "Deploy from GitHub repo"
5. Выберите ваш репозиторий (или создайте новый)

### 2.2 Добавление PostgreSQL

1. В проекте Railway нажмите "+ New"
2. Выберите "Database" → "Add PostgreSQL"
3. Railway автоматически создаст базу данных
4. Скопируйте `DATABASE_URL` из переменных окружения (он будет автоматически добавлен)

### 2.3 Настройка сервиса

1. В проекте Railway нажмите "+ New" → "GitHub Repo"
2. Выберите репозиторий с кодом `railway-backend`
3. Railway автоматически определит Node.js проект

### 2.4 Настройка переменных окружения

В настройках сервиса добавьте:

```
TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather
NODE_ENV=production
```

`DATABASE_URL` уже будет установлен автоматически Railway.

### 2.5 Деплой

Railway автоматически задеплоит проект. Дождитесь завершения деплоя.

## Шаг 3: Получение URL API

После деплоя Railway предоставит URL вашего сервиса, например:
- `https://your-app-name.up.railway.app`

Этот URL нужно будет использовать в frontend.

## Шаг 4: Обновление frontend

Нужно изменить URL API в файле `Meta Pay _ Meta_files/support.js.téléchargement`:

Замените все `/api/support/` на `https://your-app-name.up.railway.app/api/support/`

Или используйте переменную окружения для гибкости.

## Шаг 5: Использование

### Для оператора:

1. Найдите вашего бота в Telegram (по username, который вы указали)
2. Отправьте `/start`
3. Когда клиент отправит сообщение, вы получите `support_token`
4. Отправьте `/chat <support_token>` для подключения к чату
5. Теперь все ваши сообщения будут отправляться клиенту

### Для клиента:

1. Клиент открывает чат на сайте
2. Отправляет сообщения через интерфейс
3. Сообщения сохраняются в PostgreSQL на Railway
4. Оператор видит их в Telegram и может ответить

## Архитектура

```
Клиент (браузер)
    ↓ POST /api/support/sendMessage
Railway Backend
    ↓ Сохранение в PostgreSQL
    ↓ Уведомление в Telegram
Telegram Bot → Оператор

Оператор (Telegram)
    ↓ Отправка сообщения
Telegram Bot
    ↓ Сохранение в PostgreSQL
Railway Backend
    ↓ Polling каждые 1.5 сек
Клиент (браузер) ← GET /api/support/getMessages1
```

## Проверка работы

1. Откройте сайт с чатом
2. Отправьте тестовое сообщение
3. Проверьте Telegram бота - должно прийти уведомление
4. Подключитесь к чату: `/chat <support_token>`
5. Отправьте ответ в Telegram
6. Проверьте сайт - сообщение должно появиться

## Troubleshooting

### Бот не отвечает:
- Проверьте `TELEGRAM_BOT_TOKEN` в переменных окружения Railway
- Проверьте логи в Railway Dashboard

### Сообщения не сохраняются:
- Проверьте `DATABASE_URL` в переменных окружения
- Проверьте логи на наличие ошибок подключения к БД

### API не отвечает:
- Проверьте URL в Railway Dashboard
- Проверьте health check: `https://your-app.up.railway.app/health`
- Проверьте логи деплоя

