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
            console.log('✅ Подключено к PostgreSQL');

            // Создаем таблицу сообщений (используем нижний регистр для совместимости)
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    supporttoken TEXT NOT NULL,
                    message TEXT,
                    image TEXT,
                    messagefrom INTEGER NOT NULL DEFAULT 1,
                    createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Исправляем существующие записи с NULL или некорректными значениями
            await pgClient.query(`
                UPDATE messages 
                SET messagefrom = 1 
                WHERE messagefrom IS NULL OR messagefrom NOT IN (0, 1)
            `);
            
            console.log('✅ Таблица messages готова');
            return pgClient;
        } catch (err) {
            console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
            throw err;
        }
    } else {
        // Используем SQLite (локально или с volume на Railway)
        return new Promise((resolve, reject) => {
            const DB_PATH = DATABASE_URL || path.join(__dirname, 'chat.db');
            const db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    console.error('❌ Ошибка подключения к SQLite:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ Подключено к SQLite');
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
                    console.error('❌ Ошибка создания таблицы:', err.message);
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
                        console.error('❌ Ошибка исправления записей:', updateErr.message);
                    }
                    console.log('✅ Таблица messages готова');
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
        throw new Error(`Invalid messageFrom: ${messageFrom}`);
    }
    
    if (USE_POSTGRES) {
        if (!db.query) {
            throw new Error('PostgreSQL клиент не инициализирован');
        }
        const result = await db.query(
            `INSERT INTO messages (supporttoken, message, image, messagefrom) VALUES ($1, $2, $3, $4) RETURNING *`,
            [supportToken, message, image, messageFromNum]
        );
        const saved = result.rows[0];
        // Нормализуем messageFrom для возврата
        return {
            ...saved,
            messageFrom: saved.messagefrom || saved.messageFrom || messageFromNum
        };
    } else {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO messages (supportToken, message, image, messageFrom) VALUES (?, ?, ?, ?)`;
            db.run(sql, [supportToken, message, image, messageFromNum], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ 
                    id: this.lastID, 
                    supportToken, 
                    message, 
                    image, 
                    messageFrom: messageFromNum,
                    createdAt: new Date().toISOString()
                });
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
            throw new Error('PostgreSQL клиент не инициализирован');
        }
        const result = await db.query(
            `SELECT * FROM messages WHERE supporttoken = $1 ORDER BY createdat ASC`,
            [supportToken]
        );
        
        // Нормализуем messageFrom (PostgreSQL возвращает messagefrom в нижнем регистре)
        return result.rows.map(row => {
            const messageFrom = row.messagefrom || row.messageFrom;
            return {
                ...row,
                messageFrom: messageFrom === null || messageFrom === undefined ? 1 : 
                            (parseInt(messageFrom, 10) === 0 ? 0 : 1)
            };
        });
    } else {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM messages WHERE supportToken = ? ORDER BY createdAt ASC`;
            db.all(sql, [supportToken], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Нормализуем messageFrom (убеждаемся, что это число 0 или 1)
                const normalized = rows.map(row => ({
                    ...row,
                    messageFrom: row.messageFrom === null || row.messageFrom === undefined ? 1 : 
                                (parseInt(row.messageFrom, 10) === 0 ? 0 : 1)
                }));
                
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
            throw new Error('PostgreSQL клиент не инициализирован');
        }
        const result = await db.query(
            `SELECT * FROM messages WHERE supporttoken = $1 ORDER BY createdat DESC LIMIT 1`,
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

module.exports = {
    initDatabase,
    saveMessage,
    getMessages,
    getLastMessage
};
