const TelegramBot = require('node-telegram-bot-api');
const { saveMessage, getMessages } = require('./database');

class TelegramSupportBot {
    constructor(token, operatorChatId, db) {
        this.bot = new TelegramBot(token, { polling: true });
        this.operatorChatId = operatorChatId;
        this.db = db;
        this.activeChats = new Map(); // supportToken -> messageId в Telegram
        this.pendingReply = null; // Токен для ожидаемого ответа
        
        this.setupHandlers();
    }

    setupHandlers() {
        // Обработка callback кнопок (кнопка "Ответить")
        this.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;
            
            if (chatId.toString() !== this.operatorChatId.toString()) {
                return;
            }

            if (data.startsWith('reply_')) {
                const supportToken = data.replace('reply_', '');
                // Сохраняем токен для следующего сообщения
                this.pendingReply = supportToken;
                
                await this.bot.answerCallbackQuery(query.id);
                await this.bot.sendMessage(chatId, 
                    `💬 Теперь отправьте ответ для клиента с токеном: ${supportToken}\n` +
                    `Или ответьте на сообщение клиента (reply)`
                );
            }
        });

        // Обработка всех текстовых сообщений
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            // Игнорируем служебные сообщения и команды
            if (msg.photo || msg.document || msg.sticker || text?.startsWith('/')) {
                return;
            }

            // Если сообщение от оператора (в личке с ботом)
            if (chatId.toString() === this.operatorChatId.toString()) {
                let supportToken = null;
                
                // Проверяем reply на сообщение
                if (msg.reply_to_message) {
                    supportToken = this.findActiveChatByReply(msg);
                }
                
                // Или используем сохраненный токен из callback
                if (!supportToken && this.pendingReply) {
                    supportToken = this.pendingReply;
                    this.pendingReply = null;
                }
                
                if (supportToken) {
                    // Сохраняем ответ оператора в БД
                    await saveMessage(this.db, supportToken, text, null, 0);
                    console.log(`Оператор ответил на чат ${supportToken}: ${text}`);
                    
                    // Отправляем подтверждение оператору
                    await this.bot.sendMessage(chatId, `✅ Ответ отправлен клиенту с токеном: ${supportToken}`);
                } else {
                    // Если нет активного чата, показываем инструкцию
                    await this.bot.sendMessage(chatId, 
                        '❓ Не понятно, кому отвечать.\n\n' +
                        'Для ответа клиенту:\n' +
                        '1. Нажмите кнопку "Ответить" под сообщением клиента\n' +
                        '2. Или ответьте на сообщение клиента (reply)\n' +
                        '3. Или используйте команду: /reply <supportToken> <сообщение>'
                    );
                }
            }
        });

        // Обработка команды /reply для прямого ответа
        this.bot.onText(/\/reply (.+) (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            
            if (chatId.toString() !== this.operatorChatId.toString()) {
                return;
            }

            const supportToken = match[1];
            const replyText = match[2];

            await saveMessage(this.db, supportToken, replyText, null, 0);
            await this.bot.sendMessage(chatId, `✅ Ответ отправлен клиенту с токеном: ${supportToken}`);
        });

        // Обработка команды /chats - список активных чатов
        this.bot.onText(/\/chats/, async (msg) => {
            const chatId = msg.chat.id;
            
            if (chatId.toString() !== this.operatorChatId.toString()) {
                return;
            }

            const activeChatsList = Array.from(this.activeChats.keys())
                .map(token => `• ${token}`)
                .join('\n') || 'Нет активных чатов';

            this.bot.sendMessage(chatId, `Активные чаты:\n${activeChatsList}`);
        });

        // Обработка команды /history <supportToken> - история чата
        this.bot.onText(/\/history (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            
            if (chatId.toString() !== this.operatorChatId.toString()) {
                return;
            }

            const supportToken = match[1];
            const messages = await getMessages(this.db, supportToken);
            
            if (messages.length === 0) {
                this.bot.sendMessage(chatId, `История чата ${supportToken} пуста`);
                return;
            }

            const history = messages
                .map(m => {
                    const from = m.messageFrom === 1 ? '👤 Клиент' : '👨‍💼 Оператор';
                    return `${from}: ${m.message || '[Изображение]'}`;
                })
                .join('\n\n');

            // Telegram ограничивает длину сообщения 4096 символов
            if (history.length > 4000) {
                const chunks = history.match(/.{1,4000}/g) || [];
                for (const chunk of chunks) {
                    await this.bot.sendMessage(chatId, chunk);
                }
            } else {
                this.bot.sendMessage(chatId, `История чата ${supportToken}:\n\n${history}`);
            }
        });

        console.log('Telegram бот инициализирован');
    }

    // Отправка сообщения от клиента оператору в Telegram
    async sendToOperator(supportToken, message, imageBuffer = null) {
        try {
            let telegramMessage = `📩 Новое сообщение от клиента\n\n`;
            telegramMessage += `Токен: \`${supportToken}\`\n`;
            telegramMessage += `Сообщение: ${message || '[Изображение]'}`;

            const replyMarkup = {
                inline_keyboard: [[
                    { text: '💬 Ответить', callback_data: `reply_${supportToken}` }
                ]]
            };

            if (imageBuffer) {
                // Отправляем изображение как Buffer с подписью
                const sentMsg = await this.bot.sendPhoto(this.operatorChatId, imageBuffer, {
                    caption: telegramMessage,
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup
                });
                
                // Сохраняем связь для reply
                this.activeChats.set(supportToken, sentMsg.message_id);
            } else {
                // Отправляем текстовое сообщение
                const sentMsg = await this.bot.sendMessage(this.operatorChatId, telegramMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup
                });

                // Сохраняем связь между сообщением и токеном для reply
                this.activeChats.set(supportToken, sentMsg.message_id);
            }

            console.log(`Сообщение отправлено оператору для токена: ${supportToken}`);
        } catch (error) {
            console.error('Ошибка отправки в Telegram:', error);
        }
    }

    // Поиск активного чата по reply
    findActiveChatByReply(msg) {
        if (!msg.reply_to_message) {
            return null;
        }

        // Ищем токен в сохраненных активных чатах
        for (const [token, messageId] of this.activeChats.entries()) {
            if (messageId === msg.reply_to_message.message_id) {
                return token;
            }
        }

        return null;
    }
}

module.exports = TelegramSupportBot;

