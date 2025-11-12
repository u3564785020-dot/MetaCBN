const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Telegraf } = require('telegraf');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL connection (Railway автоматически предоставляет DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Инициализация таблицы сообщений
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        support_token VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        message_from INTEGER NOT NULL DEFAULT 1,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_support_token ON messages(support_token);
      CREATE INDEX IF NOT EXISTS idx_created_at ON messages(created_at);
    `);
    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Хранилище активных чатов (support_token -> telegram_chat_id)
const activeChats = new Map();

// Команда /start для оператора
bot.command('start', (ctx) => {
  ctx.reply(`👋 Добро пожаловать в Meta Pay Support Bot!

📋 Доступные команды:
/chat <support_token> - Подключиться к чату клиента
/disconnect - Отключиться от текущего чата
/list - Показать активные чаты
/help - Показать эту справку

💡 Как использовать:
1. Когда клиент отправит сообщение, вы получите support_token
2. Отправьте /chat <support_token> для подключения
3. Просто отправляйте сообщения - они автоматически появятся у клиента

📸 Вы также можете отправлять изображения - они будут доставлены клиенту.`);
});

// Команда /help
bot.command('help', (ctx) => {
  ctx.reply(`📋 Справка по командам:

/start - Начать работу с ботом
/chat <support_token> - Подключиться к чату клиента
/disconnect - Отключиться от текущего чата
/list - Показать список активных чатов
/help - Показать эту справку

💡 Пример использования:
/chat ayb0uj0hyu9mhul0ftp

После подключения просто отправляйте текстовые сообщения или изображения - они автоматически появятся у клиента.`);
});

// Команда для подключения к чату клиента
bot.command('chat', async (ctx) => {
  const supportToken = ctx.message.text.split(' ')[1];
  if (!supportToken) {
    return ctx.reply('Использование: /chat <support_token>\n\nПример: /chat ayb0uj0hyu9mhul0ftp');
  }
  
  activeChats.set(supportToken, ctx.chat.id);
  ctx.reply(`✅ Подключено к чату: ${supportToken}\n\nТеперь вы будете получать все сообщения от этого клиента.\nПросто отправьте сообщение, чтобы ответить.\n\nИспользуйте /disconnect для отключения.`);
  
  // Отправляем последние сообщения
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE support_token = $1 ORDER BY created_at DESC LIMIT 20',
      [supportToken]
    );
    
    if (result.rows.length > 0) {
      ctx.reply(`📜 История сообщений (последние ${result.rows.length}):`);
      for (const msg of result.rows.reverse()) {
        const sender = msg.message_from === 1 ? '👤 Клиент' : '👨‍💼 Вы';
        const time = new Date(msg.created_at).toLocaleTimeString('ru-RU');
        if (msg.image_url) {
          ctx.reply(`${sender} [${time}]: [Изображение]`);
        } else {
          ctx.reply(`${sender} [${time}]: ${msg.message}`);
        }
      }
    } else {
      ctx.reply('📭 История сообщений пуста. Ожидаю сообщений от клиента...');
    }
  } catch (error) {
    console.error('Error fetching messages:', error);
    ctx.reply('⚠️ Ошибка при загрузке истории сообщений');
  }
});

// Команда для отключения от чата
bot.command('disconnect', (ctx) => {
  let disconnected = false;
  for (const [token, chatId] of activeChats.entries()) {
    if (chatId === ctx.chat.id) {
      activeChats.delete(token);
      disconnected = true;
      break;
    }
  }
  
  if (disconnected) {
    ctx.reply('✅ Отключено от чата');
  } else {
    ctx.reply('ℹ️ Вы не подключены ни к одному чату');
  }
});

// Команда для списка активных чатов
bot.command('list', (ctx) => {
  const userChats = [];
  for (const [token, chatId] of activeChats.entries()) {
    if (chatId === ctx.chat.id) {
      userChats.push(token);
    }
  }
  
  if (userChats.length > 0) {
    ctx.reply(`📋 Ваши активные чаты:\n${userChats.map(t => `• ${t}`).join('\n')}`);
  } else {
    ctx.reply('📭 У вас нет активных чатов');
  }
});

// Обработка текстовых сообщений от оператора
bot.on('text', async (ctx) => {
  // Пропускаем команды
  if (ctx.message.text.startsWith('/')) {
    return;
  }
  
  // Находим активный чат для этого оператора
  let supportToken = null;
  for (const [token, chatId] of activeChats.entries()) {
    if (chatId === ctx.chat.id) {
      supportToken = token;
      break;
    }
  }
  
  if (!supportToken) {
    return ctx.reply('❌ Вы не подключены к чату.\n\nИспользуйте /chat <support_token> для подключения.\nИспользуйте /help для списка команд.');
  }
  
  // Сохраняем сообщение в БД
  try {
    const result = await pool.query(
      'INSERT INTO messages (support_token, message, message_from) VALUES ($1, $2, $3) RETURNING *',
      [supportToken, ctx.message.text, 0] // 0 = оператор
    );
    
    ctx.reply('✅ Сообщение отправлено клиенту!');
  } catch (error) {
    console.error('Error saving message:', error);
    ctx.reply('❌ Ошибка при отправке сообщения. Попробуйте позже.');
  }
});

// Обработка изображений от оператора
bot.on('photo', async (ctx) => {
  let supportToken = null;
  for (const [token, chatId] of activeChats.entries()) {
    if (chatId === ctx.chat.id) {
      supportToken = token;
      break;
    }
  }
  
  if (!supportToken) {
    return ctx.reply('❌ Вы не подключены к чату. Используйте /chat <support_token>');
  }
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    await pool.query(
      'INSERT INTO messages (support_token, message, message_from, image_url) VALUES ($1, $2, $3, $4)',
      [supportToken, '', 0, fileUrl]
    );
    
    ctx.reply('✅ Изображение отправлено клиенту!');
  } catch (error) {
    console.error('Error saving image:', error);
    ctx.reply('❌ Ошибка при отправке изображения');
  }
});

// Запуск Telegram бота
bot.launch().then(() => {
  console.log('Telegram bot started');
}).catch((error) => {
  console.error('Telegram bot error:', error);
});

// API: Отправка сообщения от клиента
app.post('/api/support/sendMessage', async (req, res) => {
  try {
    const { supportToken, message } = req.body;
    
    if (!supportToken || !message) {
      return res.status(400).json({ error: 'Missing supportToken or message' });
    }
    
    const result = await pool.query(
      'INSERT INTO messages (support_token, message, message_from) VALUES ($1, $2, $3) RETURNING *',
      [supportToken, message, 1] // 1 = клиент
    );
    
    // Уведомляем оператора в Telegram, если он подключен
    const telegramChatId = activeChats.get(supportToken);
    if (telegramChatId) {
      try {
        await bot.telegram.sendMessage(telegramChatId, `👤 Клиент: ${message}`);
      } catch (error) {
        console.error('Error sending to Telegram:', error);
      }
    } else {
      // Если оператор не подключен, отправляем уведомление с инструкцией
      // Можно добавить список администраторов для уведомлений
      const adminChatIds = process.env.ADMIN_CHAT_IDS ? process.env.ADMIN_CHAT_IDS.split(',') : [];
      for (const adminId of adminChatIds) {
        try {
          await bot.telegram.sendMessage(
            adminId,
            `🔔 Новое сообщение от клиента!\n\nSupport Token: ${supportToken}\nСообщение: ${message}\n\nИспользуйте /chat ${supportToken} для подключения к чату.`
          );
        } catch (error) {
          console.error('Error notifying admin:', error);
        }
      }
    }
    
    res.json({ success: true, message: result.rows[0] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API: Отправка изображения от клиента
app.post('/api/support/sendImage', upload.single('image'), async (req, res) => {
  try {
    const { supportToken } = req.body;
    const image = req.file;
    
    if (!supportToken || !image) {
      return res.status(400).json({ error: 'Missing supportToken or image' });
    }
    
    // Сохраняем изображение (можно использовать Railway volumes или S3)
    // Для простоты сохраняем в base64 или загружаем на внешний хостинг
    const imageBase64 = image.buffer.toString('base64');
    const imageUrl = `data:image/jpeg;base64,${imageBase64}`;
    
    const result = await pool.query(
      'INSERT INTO messages (support_token, message, message_from, image_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [supportToken, '', 1, imageUrl]
    );
    
    // Уведомляем оператора в Telegram
    const telegramChatId = activeChats.get(supportToken);
    if (telegramChatId) {
      try {
        await bot.telegram.sendPhoto(telegramChatId, { source: image.buffer });
      } catch (error) {
        console.error('Error sending image to Telegram:', error);
      }
    }
    
    res.json({ success: true, message: result.rows[0] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API: Получение сообщений (polling от клиента)
app.post('/api/support/getMessages1', async (req, res) => {
  try {
    const { supportToken } = req.body;
    
    if (!supportToken) {
      return res.status(400).json({ error: 'Missing supportToken' });
    }
    
    const result = await pool.query(
      'SELECT * FROM messages WHERE support_token = $1 ORDER BY created_at ASC',
      [supportToken]
    );
    
    const messages = result.rows.map(row => ({
      id: row.id,
      message: row.image_url || row.message,
      messageFrom: row.message_from,
      image: !!row.image_url,
      createdAt: row.created_at
    }));
    
    res.json({ messages });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check для Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;

// Инициализация БД и запуск сервера
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

