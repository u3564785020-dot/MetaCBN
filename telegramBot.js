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
        
        // Создаем бота С polling сразу
        this.bot = new TelegramBot(token, { polling: true });
        
        // Регистрируем обработчик ошибок polling
        this.bot.on('polling_error', (error) => {
            console.error('❌ Polling error:', error.message, error.code);
            if (error.code === 409 || error.message.includes('409')) {
                console.warn('⚠️ Конфликт polling (409). Перезапуск через 10 секунд...');
                this.stopPolling().then(() => {
                    setTimeout(() => this.startPolling(), 10000);
                }).catch(() => {
                    setTimeout(() => this.startPolling(), 10000);
                });
            } else {
                setTimeout(() => this.startPolling(), 5000);
            }
        });
        
        // Регистрируем обработчики
        this.setupHandlers();
        
        // Проверяем подключение
        this.bot.getMe().then(botInfo => {
            console.log(`✅ Telegram бот подключен: @${botInfo.username}`);
        }).catch(err => {
            console.error(`❌ Ошибка подключения:`, err.message);
        });
    }


    setupHandlers() {
        console.log('🔧 Регистрация обработчиков...');
        
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

        // 2. Обработчик ВСЕХ сообщений через on('message')
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat?.id;
            const text = msg.text || msg.caption;
            
            // ДИАГНОСТИКА: Логируем ВСЕ сообщения
            console.log(`🔍 [MSG] Получено сообщение: chatId=${chatId} (тип: ${typeof chatId}), operatorChatId=${this.operatorChatId} (тип: ${typeof this.operatorChatId}), text="${text?.substring(0, 50) || 'нет'}"`);
            
            // Пропускаем команды (их обработает onText)
            if (text && text.startsWith('/')) {
                console.log(`🔍 [MSG] Пропуск: команда`);
                return;
            }
            
            // Пропускаем сообщения без текста
            if (!text) {
                console.log(`🔍 [MSG] Пропуск: нет текста`);
                return;
            }
            
            // Проверяем, что это сообщение от оператора
            const chatIdStr = String(chatId);
            const operatorChatIdStr = String(this.operatorChatId);
            console.log(`🔍 [MSG] Сравнение: "${chatIdStr}" === "${operatorChatIdStr}" ? ${chatIdStr === operatorChatIdStr}`);
            
            if (chatIdStr !== operatorChatIdStr) {
                console.log(`🔍 [MSG] Пропуск: не от оператора`);
                return;
            }
            
            console.log(`✅ [MSG] Это сообщение от оператора! Обрабатываем...`);
            
            // Ищем токен поддержки
            let supportToken = null;
            
            // Способ 1: через reply
            if (msg.reply_to_message) {
                console.log(`🔍 [MSG] Есть reply_to_message, ищем токен...`);
                supportToken = this.findActiveChatByReply(msg);
                console.log(`🔍 [MSG] Токен через reply: ${supportToken || 'не найден'}`);
            }
            
            // Способ 2: через pendingReply (кнопка "Ответить")
            if (!supportToken && this.pendingReply) {
                supportToken = this.pendingReply;
                this.pendingReply = null;
                console.log(`🔍 [MSG] Токен через pendingReply: ${supportToken}`);
            }
            
            // Сохраняем сообщение оператора
            if (supportToken) {
                try {
                    console.log(`💾 [MSG] Сохранение в БД: токен=${supportToken}, messageFrom=0`);
                    const savedMessage = await saveMessage(this.db, supportToken, text, null, 0);
                    console.log(`✅ [MSG] Сохранено: ID=${savedMessage.id}, messageFrom=${savedMessage.messageFrom}`);
                    await this.bot.sendMessage(chatId, 
                        `✅ Ответ отправлен\n\n🔑 Токен: ${supportToken}\n💬 Клиент получит ваш ответ`
                    );
                } catch (error) {
                    console.error(`❌ [MSG] Ошибка сохранения:`, error);
                    await this.bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
                }
            } else {
                console.warn(`⚠️ [MSG] Токен не найден! pendingReply=${this.pendingReply}, reply_to_message=${msg.reply_to_message ? 'есть' : 'нет'}`);
                await this.bot.sendMessage(chatId, 
                    '❓ Не понятно, кому отвечать\n\n📋 Для ответа клиенту:\n\n1️⃣ Нажмите кнопку "💬 Ответить" под сообщением клиента\n2️⃣ Или ответьте на сообщение клиента (reply)\n3️⃣ Или используйте команду:\n/reply <токен> <сообщение>'
                );
            }
        });

        // 3. Команда /reply (более специфичный паттерн, обрабатывается раньше универсального)
        this.bot.onText(/\/reply (.+) (.+)/, async (msg, match) => {
            try {
                const chatId = String(msg.chat.id);
                if (chatId !== this.operatorChatId) return;
                
                const supportToken = match[1];
                const replyText = match[2];
                
                console.log(`📝 [REPLY CMD] Команда /reply: токен=${supportToken}, сообщение="${replyText.substring(0, 50)}"`);
                
                const savedMessage = await saveMessage(this.db, supportToken, replyText, null, 0);
                console.log(`✅ [REPLY CMD] Ответ через /reply сохранен: ID=${savedMessage.id}, messageFrom=${savedMessage.messageFrom}`);
                
                await this.bot.sendMessage(chatId, 
                    `✅ Ответ отправлен\n\n🔑 Токен: ${supportToken}\n💬 Клиент получит ваш ответ`
                );
            } catch (error) {
                console.error('❌ [REPLY CMD] Ошибка:', error);
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
        
        console.log('✅ Обработчики зарегистрированы');
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
                return token;
            }
        }
        
        // Ищем токен в тексте сообщения
        if (msg.reply_to_message.text || msg.reply_to_message.caption) {
            const text = msg.reply_to_message.text || msg.reply_to_message.caption;
            const patterns = [
                /Токен[:\s]*`?([a-zA-Z0-9]+)`?/i,
                /🔑[:\s]*`?([a-zA-Z0-9]+)`?/i,
                /токен[:\s]*`?([a-zA-Z0-9]+)`?/i,
                /`([a-zA-Z0-9]{20,})`/
            ];
            
            for (const pattern of patterns) {
                const tokenMatch = text.match(pattern);
                if (tokenMatch && tokenMatch[1]) {
                    const token = tokenMatch[1];
                    this.activeChats.set(token, repliedMessageId);
                    return token;
                }
            }
        }
        
        return null;
    }
}

module.exports = TelegramSupportBot;
