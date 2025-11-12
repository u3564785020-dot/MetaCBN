const TelegramBot = require('node-telegram-bot-api');
const { saveMessage, getMessages } = require('./database');

class TelegramSupportBot {
    constructor(token, operatorChatId, db) {
        console.log(`🔧 Инициализация TelegramSupportBot...`);
        console.log(`   Token: ${token ? `${token.substring(0, 10)}...` : 'НЕ УКАЗАН'}`);
        console.log(`   OperatorChatId: ${operatorChatId || 'НЕ УКАЗАН'}`);
        console.log(`   DB: ${db ? 'OK' : 'НЕТ'}`);
        
        // КРИТИЧЕСКИ ВАЖНО: Создаем бота БЕЗ polling сначала
        this.bot = new TelegramBot(token, { polling: false });
        this.operatorChatId = operatorChatId;
        this.db = db;
        this.activeChats = new Map(); // supportToken -> messageId в Telegram
        this.pendingReply = null; // Токен для ожидаемого ответа
        
        // СНАЧАЛА регистрируем обработчики
        this.setupHandlers();
        
        // ПОТОМ запускаем polling
        this.startPolling();
        
        // Проверка соединения с Telegram
        this.bot.getMe().then(botInfo => {
            console.log(`✅ Telegram бот подключен: @${botInfo.username} (ID: ${botInfo.id})`);
        }).catch(err => {
            console.error(`❌ Ошибка подключения к Telegram:`, err.message);
        });
        
        console.log(`✅ TelegramSupportBot инициализирован`);
    }
    
    startPolling() {
        try {
            console.log(`🔄 Запуск Telegram polling...`);
            this.bot.startPolling({
                restart: true
            }).then(() => {
                console.log(`✅ Telegram polling запущен успешно`);
            }).catch(err => {
                console.error(`❌ Ошибка запуска polling:`, err);
                // Повторная попытка через 5 секунд
                setTimeout(() => {
                    console.log(`🔄 Повторная попытка запуска polling...`);
                    this.startPolling();
                }, 5000);
            });
            
        } catch (error) {
            console.error(`❌ Критическая ошибка при запуске polling:`, error);
        }
    }

    setupHandlers() {
        console.log(`🔧 Настройка обработчиков Telegram бота...`);
        
        // КРИТИЧЕСКИЙ ФИКС: Обработчик сообщений должен быть ПЕРВЫМ
        // чтобы перехватывать ВСЕ сообщения до onText()
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat?.id;
            const text = msg.text || msg.caption;
            
            // Логируем ВСЕ сообщения
            console.log(`📨 MESSAGE: chatId=${chatId}, text="${text?.substring(0, 50)}", from=${msg.from?.id}`);
            
            // Проверяем, что это сообщение от оператора
            if (chatId && chatId.toString() === this.operatorChatId.toString()) {
                // Если это команда, пропускаем (onText обработает)
                if (text && text.startsWith('/')) {
                    return;
                }
                
                // Если нет текста (фото/документ), пропускаем
                if (!text) {
                    return;
                }
                
                // Обрабатываем сообщение от оператора
                let supportToken = null;
                
                if (msg.reply_to_message) {
                    supportToken = this.findActiveChatByReply(msg);
                }
                
                if (!supportToken && this.pendingReply) {
                    supportToken = this.pendingReply;
                    this.pendingReply = null;
                }
                
                if (supportToken) {
                    try {
                        const savedMessage = await saveMessage(this.db, supportToken, text, null, 0);
                        console.log(`✅ Сохранено сообщение оператора: ID=${savedMessage.id}, messageFrom=${savedMessage.messageFrom}`);
                        
                        const escapedToken = this.escapeMarkdownV2(supportToken);
                        await this.bot.sendMessage(chatId, 
                            `✅ *Ответ отправлен*\n\n` +
                            `🔑 Токен: \`${escapedToken}\`\n` +
                            `💬 Клиент получит ваш ответ`,
                            { parse_mode: 'MarkdownV2' }
                        );
                    } catch (error) {
                        console.error(`❌ Ошибка сохранения:`, error);
                    }
                } else {
                    await this.bot.sendMessage(chatId, 
                        '❓ *Не понятно, кому отвечать*\n\n' +
                        '📋 *Для ответа клиенту:*\n\n' +
                        '1️⃣ Нажмите кнопку "💬 Ответить" под сообщением клиента\n' +
                        '2️⃣ Или ответьте на сообщение клиента \\(reply\\)\n' +
                        '3️⃣ Или используйте команду:\n`/reply <токен> <сообщение>`',
                        { parse_mode: 'MarkdownV2' }
                    );
                }
            }
        });
        
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
                console.log(`Кнопка "Ответить" нажата. Установлен pendingReply: ${supportToken}`);
                
                await this.bot.answerCallbackQuery(query.id);
                const escapedToken = this.escapeMarkdownV2(supportToken);
                await this.bot.sendMessage(chatId, 
                    `💬 *Готово к ответу*\n\n` +
                    `🔑 Токен: \`${escapedToken}\`\n\n` +
                    `📝 Отправьте ваш ответ текстом\n` +
                    `Или ответьте на сообщение клиента \\(reply\\)`,
                    { parse_mode: 'MarkdownV2' }
                );
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

            console.log(`💾 Команда /reply. Токен: ${supportToken}, Сообщение: "${replyText}", messageFrom: 0 (ОПЕРАТОР)`);
            
            try {
                const savedMessage = await saveMessage(this.db, supportToken, replyText, null, 0);
                console.log(`✅ Ответ через /reply сохранен в БД с ID: ${savedMessage.id}, messageFrom: ${savedMessage.messageFrom}`);
                
                // Проверяем сохранение - получаем ВСЕ сообщения
                const verifyMessages = await getMessages(this.db, supportToken);
                const operatorMsgs = verifyMessages.filter(m => m.messageFrom === 0);
                const clientMsgs = verifyMessages.filter(m => m.messageFrom === 1);
                console.log(`🔍 Проверка /reply: Всего сообщений для токена ${supportToken}: ${verifyMessages.length} (${clientMsgs.length} от клиента, ${operatorMsgs.length} от оператора)`);
                
                if (operatorMsgs.length === 0) {
                    console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: Сообщение оператора не найдено после сохранения!`);
                }
                
                const escapedToken = this.escapeMarkdownV2(supportToken);
                await this.bot.sendMessage(chatId, 
                    `✅ *Ответ отправлен*\n\n` +
                    `🔑 Токен: \`${escapedToken}\`\n` +
                    `💬 Клиент получит ваш ответ`,
                    { parse_mode: 'MarkdownV2' }
                );
            } catch (error) {
                console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА при сохранении через /reply:`, error);
                const escapedToken = this.escapeMarkdownV2(supportToken);
                const escapedError = this.escapeMarkdownV2(error.message);
                await this.bot.sendMessage(chatId, 
                    `❌ *Ошибка сохранения*\n\n` +
                    `🔑 Токен: \`${escapedToken}\`\n` +
                    `⚠️ Ошибка: ${escapedError}`,
                    { parse_mode: 'MarkdownV2' }
                );
            }
        });

        // Обработка команды /chats - список активных чатов
        this.bot.onText(/\/chats/, async (msg) => {
            const chatId = msg.chat.id;
            
            if (chatId.toString() !== this.operatorChatId.toString()) {
                return;
            }

            const activeChatsList = Array.from(this.activeChats.keys())
                .map(token => `🔑 \`${this.escapeMarkdownV2(token)}\``)
                .join('\n') || '📭 Нет активных чатов';

            this.bot.sendMessage(chatId, 
                `📋 *Активные чаты:*\n\n${activeChatsList}`,
                { parse_mode: 'MarkdownV2' }
            );
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
                const escapedToken = this.escapeMarkdownV2(supportToken);
                this.bot.sendMessage(chatId, 
                    `📭 История чата \`${escapedToken}\` пуста`,
                    { parse_mode: 'MarkdownV2' }
                );
                return;
            }

            const escapedToken = this.escapeMarkdownV2(supportToken);
            let history = `📜 *История чата*\n\n`;
            history += `🔑 Токен: \`${escapedToken}\`\n\n`;
            history += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            const historyMessages = messages
                .map(m => {
                    const from = m.messageFrom === 1 ? '👤 *Клиент*' : '👨‍💼 *Оператор*';
                    const message = this.escapeMarkdownV2(m.message || '📷 [Изображение]');
                    return `${from}:\n${message}`;
                })
                .join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n');

            history += historyMessages;

            // Telegram ограничивает длину сообщения 4096 символов
            if (history.length > 4000) {
                const chunks = history.match(/.{1,4000}/g) || [];
                for (const chunk of chunks) {
                    await this.bot.sendMessage(chatId, chunk, { parse_mode: 'MarkdownV2' });
                }
            } else {
                this.bot.sendMessage(chatId, history, { parse_mode: 'MarkdownV2' });
            }
        });

        console.log(`✅ Обработчики Telegram бота настроены`);
        console.log(`📱 Ожидание сообщений от оператора (Chat ID: ${this.operatorChatId})`);
    }

    // Экранирование специальных символов для MarkdownV2
    escapeMarkdownV2(text) {
        if (!text) return '';
        return text.toString()
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

    // Отправка сообщения от клиента оператору в Telegram
    async sendToOperator(supportToken, message, imageBuffer = null) {
        try {
            // Красивое форматирование сообщения
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

            if (imageBuffer) {
                // Отправляем изображение как Buffer с подписью
                const sentMsg = await this.bot.sendPhoto(this.operatorChatId, imageBuffer, {
                    caption: telegramMessage,
                    parse_mode: 'MarkdownV2',
                    reply_markup: replyMarkup
                });
                
                // Сохраняем связь для reply
                this.activeChats.set(supportToken, sentMsg.message_id);
                console.log(`💾 Сохранена связь: токен=${supportToken}, message_id=${sentMsg.message_id} (изображение)`);
            } else {
                // Отправляем текстовое сообщение
                const sentMsg = await this.bot.sendMessage(this.operatorChatId, telegramMessage, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: replyMarkup
                });

                // Сохраняем связь между сообщением и токеном для reply
                this.activeChats.set(supportToken, sentMsg.message_id);
                console.log(`💾 Сохранена связь: токен=${supportToken}, message_id=${sentMsg.message_id} (текст)`);
            }

            console.log(`✅ Сообщение отправлено оператору для токена: ${supportToken}`);
            console.log(`📊 Всего активных чатов: ${this.activeChats.size}`);
        } catch (error) {
            console.error('Ошибка отправки в Telegram:', error);
            // Fallback на обычное форматирование если MarkdownV2 не работает
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

                if (imageBuffer) {
                    const sentMsg = await this.bot.sendPhoto(this.operatorChatId, imageBuffer, {
                        caption: telegramMessage,
                        reply_markup: replyMarkup
                    });
                    this.activeChats.set(supportToken, sentMsg.message_id);
                    console.log(`💾 Сохранена связь (fallback изображение): токен=${supportToken}, message_id=${sentMsg.message_id}`);
                } else {
                    const sentMsg = await this.bot.sendMessage(this.operatorChatId, telegramMessage, {
                        reply_markup: replyMarkup
                    });
                    this.activeChats.set(supportToken, sentMsg.message_id);
                    console.log(`💾 Сохранена связь (fallback текст): токен=${supportToken}, message_id=${sentMsg.message_id}`);
                }
            } catch (fallbackError) {
                console.error('Ошибка fallback отправки:', fallbackError);
            }
        }
    }

    // Поиск активного чата по reply
    findActiveChatByReply(msg) {
        if (!msg.reply_to_message) {
            console.log(`❌ findActiveChatByReply: нет reply_to_message`);
            return null;
        }

        const repliedMessage = msg.reply_to_message;
        const repliedMessageId = repliedMessage.message_id;
        
        console.log(`🔍 Поиск токена для message_id: ${repliedMessageId}`);
        console.log(`   ActiveChats размер: ${this.activeChats.size}`);
        console.log(`   ActiveChats entries:`, Array.from(this.activeChats.entries()));

        // Сначала ищем токен в сохраненных активных чатах по message_id
        for (const [token, messageId] of this.activeChats.entries()) {
            if (messageId === repliedMessageId) {
                console.log(`✅ Найден токен по message_id: ${token}`);
                return token;
            }
        }

        // Если не нашли по message_id, пытаемся извлечь токен из текста сообщения
        if (repliedMessage.text || repliedMessage.caption) {
            const text = repliedMessage.text || repliedMessage.caption;
            console.log(`🔍 Поиск токена в тексте сообщения: "${text?.substring(0, 100)}"`);
            
            // Ищем токен в формате "Токен: `abc123`" или просто в тексте
            const tokenMatch = text.match(/Токен[:\s]*`?([a-zA-Z0-9]+)`?/i) || text.match(/🔑[:\s]*`?([a-zA-Z0-9]+)`?/i);
            if (tokenMatch && tokenMatch[1]) {
                const token = tokenMatch[1];
                console.log(`✅ Извлечен токен из текста сообщения: ${token}`);
                // Сохраняем связь для будущих reply
                this.activeChats.set(token, repliedMessageId);
                return token;
            }
        }

        console.error(`❌ Не удалось найти токен для message_id: ${repliedMessageId}`);
        console.error(`   RepliedMessage text: "${repliedMessage.text || repliedMessage.caption || 'нет текста'}"`);
        return null;
    }
}

module.exports = TelegramSupportBot;

