const TelegramBot = require('node-telegram-bot-api');
const { saveMessage } = require('./database');

class TelegramSupportBot {
    constructor(token, operatorChatId, db) {
        if (!token || !operatorChatId || !db) {
            throw new Error('TelegramSupportBot: token, operatorChatId и db обязательны');
        }
        
        this.operatorChatId = String(operatorChatId);
        this.db = db;
        this.activeChats = new Map();
        this.pendingReply = null;
        
        // Создаем бота БЕЗ polling
        this.bot = new TelegramBot(token, { polling: false });
        
        // Регистрируем обработчики
        this.setupHandlers();
        
        // Запускаем polling ПОСЛЕ регистрации всех обработчиков
        this.startPolling();
        
        // Проверяем подключение
        this.bot.getMe().then(botInfo => {
            console.log(`✅ Telegram бот подключен: @${botInfo.username}`);
        }).catch(err => {
            console.error(`❌ Ошибка подключения:`, err.message);
        });
    }

    async startPolling() {
        try {
            console.log('🔄 Запуск Telegram polling...');
            await this.bot.startPolling({
                restart: true
            });
            console.log('✅ Telegram polling запущен');
        } catch (error) {
            console.error('❌ Ошибка запуска polling:', error.message);
            // Повторная попытка через 5 секунд
            setTimeout(() => this.startPolling(), 5000);
        }
    }

    setupHandlers() {
        // 1. Обработчик callback_query (кнопка "Ответить")
        this.bot.on('callback_query', async (query) => {
            try {
                const chatId = String(query.message.chat.id);
                if (chatId !== this.operatorChatId) return;
                
                const data = query.data;
                if (data && data.startsWith('reply_')) {
                    const supportToken = data.replace('reply_', '');
                    this.pendingReply = supportToken;
                    
                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.sendMessage(chatId, 
                        `💬 Готово к ответу\n\n🔑 Токен: ${supportToken}\n\n📝 Отправьте ваш ответ текстом\nИли ответьте на сообщение клиента (reply)`
                    );
                }
            } catch (error) {
                console.error('❌ Ошибка callback_query:', error);
            }
        });

        // 2. Обработчик ВСЕХ сообщений (регистрируется ПЕРВЫМ, до onText)
        this.bot.on('message', async (msg) => {
            try {
                const chatId = String(msg.chat?.id);
                
                // Логируем ВСЕ входящие сообщения
                console.log(`📨 Получено сообщение: chatId=${chatId}, operatorChatId=${this.operatorChatId}, text="${msg.text?.substring(0, 50) || msg.caption?.substring(0, 50) || 'нет текста'}"`);
                
                // Проверяем, что это сообщение от оператора
                if (chatId !== this.operatorChatId) {
                    return;
                }
                
                const text = msg.text || msg.caption;
                
                // Пропускаем команды (их обработает onText)
                if (text && text.startsWith('/')) {
                    return;
                }
                
                // Пропускаем сообщения без текста
                if (!text) {
                    return;
                }
                
                console.log(`✅ Обработка сообщения от оператора: "${text.substring(0, 50)}"`);
                
                // Ищем токен поддержки
                let supportToken = null;
                
                // Способ 1: через reply
                if (msg.reply_to_message) {
                    supportToken = this.findActiveChatByReply(msg);
                    if (supportToken) {
                        console.log(`🔑 Токен найден через reply: ${supportToken}`);
                    }
                }
                
                // Способ 2: через pendingReply (кнопка "Ответить")
                if (!supportToken && this.pendingReply) {
                    supportToken = this.pendingReply;
                    this.pendingReply = null;
                    console.log(`🔑 Токен найден через pendingReply: ${supportToken}`);
                }
                
                // Сохраняем сообщение оператора
                if (supportToken) {
                    try {
                        const savedMessage = await saveMessage(this.db, supportToken, text, null, 0);
                        console.log(`✅ Сообщение оператора сохранено: ID=${savedMessage.id}, токен=${supportToken}, messageFrom=${savedMessage.messageFrom}`);
                        
                        await this.bot.sendMessage(chatId, 
                            `✅ Ответ отправлен\n\n🔑 Токен: ${supportToken}\n💬 Клиент получит ваш ответ`
                        );
                    } catch (error) {
                        console.error('❌ Ошибка сохранения сообщения оператора:', error);
                        await this.bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
                    }
                } else {
                    console.warn(`⚠️ Не найден токен для сообщения от оператора`);
                    await this.bot.sendMessage(chatId, 
                        '❓ Не понятно, кому отвечать\n\n📋 Для ответа клиенту:\n\n1️⃣ Нажмите кнопку "💬 Ответить" под сообщением клиента\n2️⃣ Или ответьте на сообщение клиента (reply)\n3️⃣ Или используйте команду:\n/reply <токен> <сообщение>'
                    );
                }
            } catch (error) {
                console.error('❌ Ошибка обработки сообщения:', error);
            }
        });

        // 3. Команда /reply
        this.bot.onText(/\/reply (.+) (.+)/, async (msg, match) => {
            try {
                const chatId = String(msg.chat.id);
                if (chatId !== this.operatorChatId) return;
                
                const supportToken = match[1];
                const replyText = match[2];
                
                console.log(`📝 Команда /reply: токен=${supportToken}, сообщение="${replyText.substring(0, 50)}"`);
                
                const savedMessage = await saveMessage(this.db, supportToken, replyText, null, 0);
                console.log(`✅ Ответ через /reply сохранен: ID=${savedMessage.id}, messageFrom=${savedMessage.messageFrom}`);
                
                await this.bot.sendMessage(chatId, 
                    `✅ Ответ отправлен\n\n🔑 Токен: ${supportToken}\n💬 Клиент получит ваш ответ`
                );
            } catch (error) {
                console.error('❌ Ошибка /reply:', error);
                await this.bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.message}`);
            }
        });

        // 4. Команда /chats
        this.bot.onText(/\/chats/, async (msg) => {
            try {
                const chatId = String(msg.chat.id);
                if (chatId !== this.operatorChatId) return;
                
                const activeChatsList = Array.from(this.activeChats.keys())
                    .map(token => `🔑 ${token}`)
                    .join('\n') || '📭 Нет активных чатов';
                
                await this.bot.sendMessage(chatId, `📋 Активные чаты:\n\n${activeChatsList}`);
            } catch (error) {
                console.error('❌ Ошибка /chats:', error);
            }
        });

        // 5. Команда /history
        this.bot.onText(/\/history (.+)/, async (msg, match) => {
            try {
                const chatId = String(msg.chat.id);
                if (chatId !== this.operatorChatId) return;
                
                const supportToken = match[1];
                const { getMessages } = require('./database');
                const messages = await getMessages(this.db, supportToken);
                
                if (messages.length === 0) {
                    await this.bot.sendMessage(chatId, `📭 История чата ${supportToken} пуста`);
                    return;
                }
                
                let history = `📜 История чата\n\n🔑 Токен: ${supportToken}\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                const historyMessages = messages.map(m => {
                    const from = m.messageFrom === 1 ? '👤 Клиент' : '👨‍💼 Оператор';
                    const message = m.message || '📷 [Изображение]';
                    return `${from}:\n${message}`;
                }).join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');
                
                history += historyMessages;
                
                if (history.length > 4000) {
                    const chunks = history.match(/.{1,4000}/g) || [];
                    for (const chunk of chunks) {
                        await this.bot.sendMessage(chatId, chunk);
                    }
                } else {
                    await this.bot.sendMessage(chatId, history);
                }
            } catch (error) {
                console.error('❌ Ошибка /history:', error);
            }
        });
    }

    escapeMarkdownV2(text) {
        if (!text) return '';
        return String(text)
            .replace(/\_/g, '\\_')
            .replace(/\*/g, '\\*')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/\~/g, '\\~')
            .replace(/\`/g, '\\`')
            .replace(/\>/g, '\\>')
            .replace(/\#/g, '\\#')
            .replace(/\+/g, '\\+')
            .replace(/\-/g, '\\-')
            .replace(/\=/g, '\\=')
            .replace(/\|/g, '\\|')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/\./g, '\\.')
            .replace(/\!/g, '\\!');
    }

    async sendToOperator(supportToken, message, imageBuffer = null) {
        try {
            const escapedMessage = this.escapeMarkdownV2(message || '📷 [Изображение]');
            const escapedToken = this.escapeMarkdownV2(supportToken);
            
            let telegramMessage = `🔔 *НОВОЕ СООБЩЕНИЕ ОТ КЛИЕНТА*\n\n`;
            telegramMessage += `🔑 *Токен:* \`${escapedToken}\`\n`;
            telegramMessage += `💬 *Сообщение:*\n${escapedMessage}`;
            telegramMessage += `\n\n━━━━━━━━━━━━━━━━━━━━`;
            
            const replyMarkup = {
                inline_keyboard: [[
                    { text: '💬 Ответить', callback_data: `reply_${supportToken}` }
                ]]
            };
            
            let sentMsg;
            if (imageBuffer) {
                sentMsg = await this.bot.sendPhoto(this.operatorChatId, imageBuffer, {
                    caption: telegramMessage,
                    parse_mode: 'MarkdownV2',
                    reply_markup: replyMarkup
                });
            } else {
                sentMsg = await this.bot.sendMessage(this.operatorChatId, telegramMessage, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: replyMarkup
                });
            }
            
            this.activeChats.set(supportToken, sentMsg.message_id);
            console.log(`✅ Сообщение отправлено оператору: токен=${supportToken}, message_id=${sentMsg.message_id}`);
        } catch (error) {
            console.error('❌ Ошибка отправки в Telegram:', error.message);
            // Fallback без Markdown
            try {
                let telegramMessage = `🔔 НОВОЕ СООБЩЕНИЕ ОТ КЛИЕНТА\n\n`;
                telegramMessage += `🔑 Токен: ${supportToken}\n`;
                telegramMessage += `💬 Сообщение:\n${message || '📷 [Изображение]'}`;
                telegramMessage += `\n\n━━━━━━━━━━━━━━━━━━━━`;
                
                const replyMarkup = {
                    inline_keyboard: [[
                        { text: '💬 Ответить', callback_data: `reply_${supportToken}` }
                    ]]
                };
                
                let sentMsg;
                if (imageBuffer) {
                    sentMsg = await this.bot.sendPhoto(this.operatorChatId, imageBuffer, {
                        caption: telegramMessage,
                        reply_markup: replyMarkup
                    });
                } else {
                    sentMsg = await this.bot.sendMessage(this.operatorChatId, telegramMessage, {
                        reply_markup: replyMarkup
                    });
                }
                
                this.activeChats.set(supportToken, sentMsg.message_id);
            } catch (fallbackError) {
                console.error('❌ Ошибка fallback отправки:', fallbackError.message);
            }
        }
    }

    findActiveChatByReply(msg) {
        if (!msg.reply_to_message) return null;
        
        const repliedMessageId = msg.reply_to_message.message_id;
        
        // Ищем по message_id в activeChats
        for (const [token, messageId] of this.activeChats.entries()) {
            if (messageId === repliedMessageId) {
                console.log(`🔑 Токен найден по message_id: ${token}`);
                return token;
            }
        }
        
        // Ищем токен в тексте сообщения
        if (msg.reply_to_message.text || msg.reply_to_message.caption) {
            const text = msg.reply_to_message.text || msg.reply_to_message.caption;
            const tokenMatch = text.match(/Токен[:\s]*`?([a-zA-Z0-9]+)`?/i) || 
                              text.match(/🔑[:\s]*`?([a-zA-Z0-9]+)`?/i);
            if (tokenMatch && tokenMatch[1]) {
                const token = tokenMatch[1];
                this.activeChats.set(token, repliedMessageId);
                console.log(`🔑 Токен найден в тексте: ${token}`);
                return token;
            }
        }
        
        return null;
    }
}

module.exports = TelegramSupportBot;
