# Railway Chat Backend с Telegram интеграцией

## Описание

Бэкенд API для чата поддержки с интеграцией Telegram. Сообщения хранятся в PostgreSQL на Railway, оператор может отвечать через Telegram бота.

## Установка на Railway

1. **Создайте проект на Railway:**
   - Перейдите на https://railway.com/
   - Создайте новый проект
   - Добавьте PostgreSQL базу данных
   - Добавьте новый сервис из GitHub репозитория

2. **Настройте переменные окружения:**
   - `DATABASE_URL` - автоматически предоставляется Railway
   - `TELEGRAM_BOT_TOKEN` - токен бота от @BotFather
   - `PORT` - автоматически устанавливается Railway

3. **Создайте Telegram бота:**
   - Напишите @BotFather в Telegram
   - Отправьте `/newbot`
   - Следуйте инструкциям
   - Скопируйте токен и добавьте в переменные окружения Railway

## Использование

### Для оператора:

1. Запустите бота в Telegram
2. Отправьте `/start`
3. Подключитесь к чату клиента: `/chat <support_token>`
4. Отправляйте сообщения - они автоматически появятся у клиента

### API Endpoints:

- `POST /api/support/sendMessage` - отправка сообщения от клиента
- `POST /api/support/sendImage` - отправка изображения от клиента
- `POST /api/support/getMessages1` - получение сообщений (polling)
- `GET /health` - health check

## Структура базы данных

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  support_token VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  message_from INTEGER NOT NULL DEFAULT 1,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- `message_from`: 0 = оператор, 1 = клиент

