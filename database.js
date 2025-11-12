const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Определяем тип БД по DATABASE_URL
const DATABASE_URL = process.env.DATABASE_URL;
const USE_POSTGRES = DATABASE_URL && DATABASE_URL.startsWith('postgresql://');

let pgClient = null;

// Инициализация базы данных
async function initDatabase() {
    if (USE_POSTGRES) {
        // Используем PostgreSQL (Railway)
        const { Client } = require('pg');
        pgClient = new Client({
            connectionString: DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        try {
            await pgClient.connect();
            console.log('Подключено к PostgreSQL базе данных');

            // Создаем таблицу сообщений
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    supportToken TEXT NOT NULL,
                    message TEXT,
                    image TEXT,
                    messageFrom INTEGER NOT NULL DEFAULT 1,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Исправляем существующие записи с NULL или некорректными значениями
            const updateResult = await pgClient.query(`
                UPDATE messages 
                SET messageFrom = 1 
                WHERE messageFrom IS NULL OR messageFrom NOT IN (0, 1)
            `);
            
            if (updateResult.rowCount > 0) {
                console.log(`✅ Исправлено ${updateResult.rowCount} записей с NULL или некорректными значениями messageFrom`);
            }
            
            console.log('Таблица messages создана/проверена, исправлены некорректные записи');
            return pgClient;
        } catch (err) {
            console.error('Ошибка подключения к PostgreSQL:', err.message);
            throw err;
        }
    } else {
        // Используем SQLite (локально или с volume на Railway)
        return new Promise((resolve, reject) => {
            const DB_PATH = DATABASE_URL || path.join(__dirname, 'chat.db');
            const db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    console.error('Ошибка подключения к БД:', err.message);
                    reject(err);
                    return;
                }
                console.log('Подключено к SQLite базе данных');
            });

            // Создаем таблицу сообщений
            db.run(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supportToken TEXT NOT NULL,
                    message TEXT,
                    image TEXT,
                    messageFrom INTEGER NOT NULL DEFAULT 1,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Ошибка создания таблицы:', err.message);
                    reject(err);
                    return;
                }
                
                // Исправляем существующие записи с NULL или некорректными значениями
                db.run(`
                    UPDATE messages 
                    SET messageFrom = 1 
                    WHERE messageFrom IS NULL OR messageFrom NOT IN (0, 1)
                `, function(updateErr) {
                    if (updateErr) {
                        console.error('Ошибка исправления записей:', updateErr.message);
                    } else {
                        if (this.changes > 0) {
                            console.log(`✅ Исправлено ${this.changes} записей с NULL или некорректными значениями messageFrom`);
                        }
                        console.log('Таблица messages создана/проверена, исправлены некорректные записи');
                    }
                    resolve(db);
                });
            });
        });
    }
}

// Сохранение сообщения
async function saveMessage(db, supportToken, message, image, messageFrom) {
    if (!db) {
        throw new Error('База данных не инициализирована');
    }
    
    // Убеждаемся, что messageFrom всегда число (0 или 1)
    const messageFromNum = parseInt(messageFrom, 10);
    if (isNaN(messageFromNum) || (messageFromNum !== 0 && messageFromNum !== 1)) {
        console.error(`❌ Некорректный messageFrom: ${messageFrom}, должен быть 0 или 1`);
        throw new Error(`Invalid messageFrom: ${messageFrom}`);
    }
    
    console.log(`💾 Сохранение сообщения: токен=${supportToken}, messageFrom=${messageFromNum} (${messageFromNum === 1 ? 'клиент' : 'оператор'}), сообщение="${message?.substring(0, 50) || '[изображение]'}"`);
    
    if (USE_POSTGRES) {
        if (!db.query) {
            throw new Error('PostgreSQL клиент не инициализирован или некорректный объект БД');
        }
        const result = await db.query(
            `INSERT INTO messages (supportToken, message, image, messageFrom) VALUES ($1, $2, $3, $4) RETURNING *`,
            [supportToken, message, image, messageFromNum]
        );
        const saved = result.rows[0];
        console.log(`✅ Сохранено в PostgreSQL: ID=${saved.id}, messageFrom=${saved.messageFrom}`);
        return saved;
    } else {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO messages (supportToken, message, image, messageFrom) VALUES (?, ?, ?, ?)`;
            db.run(sql, [supportToken, message, image, messageFromNum], function(err) {
                if (err) {
                    console.error(`❌ Ошибка сохранения в SQLite:`, err);
                    reject(err);
                    return;
                }
                const saved = { id: this.lastID, supportToken, message, image, messageFrom: messageFromNum };
                console.log(`✅ Сохранено в SQLite: ID=${saved.id}, messageFrom=${saved.messageFrom}`);
                resolve(saved);
            });
        });
    }
}

// Получение всех сообщений для токена
async function getMessages(db, supportToken) {
    if (!db) {
        throw new Error('База данных не инициализирована');
    }
    
    if (USE_POSTGRES) {
        if (!db.query) {
            throw new Error('PostgreSQL клиент не инициализирован или некорректный объект БД');
        }
        const result = await db.query(
            `SELECT * FROM messages WHERE supportToken = $1 ORDER BY createdAt ASC`,
            [supportToken]
        );
        // Убеждаемся, что messageFrom всегда число (0 или 1)
        const normalized = await Promise.all(result.rows.map(async (row) => {
            let messageFrom = row.messageFrom;
            
            // Обработка NULL или undefined - исправляем в БД
            if (messageFrom === null || messageFrom === undefined) {
                console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: messageFrom = NULL для сообщения ID=${row.id}, токен=${supportToken}`);
                // Исправляем запись в БД
                try {
                    await db.query(
                        `UPDATE messages SET messageFrom = 1 WHERE id = $1`,
                        [row.id]
                    );
                    console.log(`🔧 Исправлена запись ID=${row.id} в БД: messageFrom установлен в 1`);
                } catch (fixErr) {
                    console.error(`❌ Ошибка исправления записи ID=${row.id}:`, fixErr.message);
                }
                messageFrom = 1; // По умолчанию считаем клиентом для старых записей
            }
            
            const messageFromNum = parseInt(messageFrom, 10);
            if (isNaN(messageFromNum) || (messageFromNum !== 0 && messageFromNum !== 1)) {
                console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: Некорректный messageFrom для ID=${row.id}: ${messageFrom} (тип: ${typeof messageFrom})`);
                // Исправляем некорректные данные в БД
                try {
                    await db.query(
                        `UPDATE messages SET messageFrom = 1 WHERE id = $1`,
                        [row.id]
                    );
                    console.log(`🔧 Исправлена запись ID=${row.id} в БД: некорректный messageFrom исправлен на 1`);
                } catch (fixErr) {
                    console.error(`❌ Ошибка исправления записи ID=${row.id}:`, fixErr.message);
                }
                return {
                    ...row,
                    messageFrom: 1 // По умолчанию клиент
                };
            }
            
            return {
                ...row,
                messageFrom: messageFromNum
            };
        }));
        console.log(`📥 Получено из PostgreSQL для токена ${supportToken}: ${normalized.length} сообщений`);
        normalized.forEach((m, i) => {
            if (i < 3 || i >= normalized.length - 3) {
                console.log(`  [${i}] ID=${m.id}, messageFrom=${m.messageFrom} (${m.messageFrom === 1 ? 'клиент' : 'оператор'}), message="${m.message?.substring(0, 30) || '[изображение]'}"`);
            }
        });
        return normalized;
    } else {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM messages WHERE supportToken = ? ORDER BY createdAt ASC`;
            db.all(sql, [supportToken], (err, rows) => {
                if (err) {
                    console.error(`❌ Ошибка получения из SQLite:`, err);
                    reject(err);
                    return;
                }
                // Убеждаемся, что messageFrom всегда число (0 или 1)
                const normalized = rows.map(row => {
                    let messageFrom = row.messageFrom;
                    
                    // Обработка NULL или undefined - исправляем в БД
                    if (messageFrom === null || messageFrom === undefined) {
                        console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: messageFrom = NULL для сообщения ID=${row.id}, токен=${supportToken}`);
                        // Исправляем запись в БД
                        db.run(
                            `UPDATE messages SET messageFrom = 1 WHERE id = ?`,
                            [row.id],
                            function(fixErr) {
                                if (fixErr) {
                                    console.error(`❌ Ошибка исправления записи ID=${row.id}:`, fixErr.message);
                                } else {
                                    console.log(`🔧 Исправлена запись ID=${row.id} в БД: messageFrom установлен в 1`);
                                }
                            }
                        );
                        messageFrom = 1; // По умолчанию клиент
                    }
                    
                    const messageFromNum = parseInt(messageFrom, 10);
                    if (isNaN(messageFromNum) || (messageFromNum !== 0 && messageFromNum !== 1)) {
                        console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: Некорректный messageFrom для ID=${row.id}: ${messageFrom} (тип: ${typeof messageFrom})`);
                        // Исправляем некорректные данные в БД
                        db.run(
                            `UPDATE messages SET messageFrom = 1 WHERE id = ?`,
                            [row.id],
                            function(fixErr) {
                                if (fixErr) {
                                    console.error(`❌ Ошибка исправления записи ID=${row.id}:`, fixErr.message);
                                } else {
                                    console.log(`🔧 Исправлена запись ID=${row.id} в БД: некорректный messageFrom исправлен на 1`);
                                }
                            }
                        );
                        return {
                            ...row,
                            messageFrom: 1 // По умолчанию клиент
                        };
                    }
                    
                    return {
                        ...row,
                        messageFrom: messageFromNum
                    };
                });
                console.log(`📥 Получено из SQLite для токена ${supportToken}: ${normalized.length} сообщений`);
                normalized.forEach((m, i) => {
                    if (i < 3 || i >= normalized.length - 3) {
                        console.log(`  [${i}] ID=${m.id}, messageFrom=${m.messageFrom} (${m.messageFrom === 1 ? 'клиент' : 'оператор'}), message="${m.message?.substring(0, 30) || '[изображение]'}"`);
                    }
                });
                resolve(normalized);
            });
        });
    }
}

// Получение последнего сообщения для токена (для Telegram)
async function getLastMessage(db, supportToken) {
    if (!db) {
        throw new Error('База данных не инициализирована');
    }
    
    if (USE_POSTGRES) {
        if (!db.query) {
            throw new Error('PostgreSQL клиент не инициализирован или некорректный объект БД');
        }
        const result = await db.query(
            `SELECT * FROM messages WHERE supportToken = $1 ORDER BY createdAt DESC LIMIT 1`,
            [supportToken]
        );
        return result.rows[0] || null;
    } else {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM messages WHERE supportToken = ? ORDER BY createdAt DESC LIMIT 1`;
            db.get(sql, [supportToken], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }
}

// Функция для исправления всех записей с NULL значениями messageFrom
async function fixNullMessageFrom(db) {
    if (!db) {
        throw new Error('База данных не инициализирована');
    }
    
    try {
        if (USE_POSTGRES) {
            if (!db.query) {
                throw new Error('PostgreSQL клиент не инициализирован');
            }
            const result = await db.query(`
                UPDATE messages 
                SET messageFrom = 1 
                WHERE messageFrom IS NULL
            `);
            if (result.rowCount > 0) {
                console.log(`🔧 Исправлено ${result.rowCount} записей с NULL messageFrom в PostgreSQL`);
            }
            return result.rowCount;
        } else {
            return new Promise((resolve, reject) => {
                db.run(`
                    UPDATE messages 
                    SET messageFrom = 1 
                    WHERE messageFrom IS NULL
                `, function(err) {
                    if (err) {
                        console.error('❌ Ошибка исправления NULL значений:', err);
                        reject(err);
                        return;
                    }
                    if (this.changes > 0) {
                        console.log(`🔧 Исправлено ${this.changes} записей с NULL messageFrom в SQLite`);
                    }
                    resolve(this.changes);
                });
            });
        }
    } catch (error) {
        console.error('❌ Ошибка при исправлении NULL значений:', error);
        throw error;
    }
}

module.exports = {
    initDatabase,
    saveMessage,
    getMessages,
    getLastMessage,
    fixNullMessageFrom
};

