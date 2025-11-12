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
                    messageFrom INTEGER NOT NULL,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Таблица messages создана/проверена');
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
                    messageFrom INTEGER NOT NULL,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Ошибка создания таблицы:', err.message);
                    reject(err);
                    return;
                }
                console.log('Таблица messages создана/проверена');
                resolve(db);
            });
        });
    }
}

// Сохранение сообщения
async function saveMessage(db, supportToken, message, image, messageFrom) {
    if (USE_POSTGRES) {
        const result = await db.query(
            `INSERT INTO messages (supportToken, message, image, messageFrom) VALUES ($1, $2, $3, $4) RETURNING *`,
            [supportToken, message, image, messageFrom]
        );
        return result.rows[0];
    } else {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO messages (supportToken, message, image, messageFrom) VALUES (?, ?, ?, ?)`;
            db.run(sql, [supportToken, message, image, messageFrom], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ id: this.lastID, supportToken, message, image, messageFrom });
            });
        });
    }
}

// Получение всех сообщений для токена
async function getMessages(db, supportToken) {
    if (USE_POSTGRES) {
        const result = await db.query(
            `SELECT * FROM messages WHERE supportToken = $1 ORDER BY createdAt ASC`,
            [supportToken]
        );
        return result.rows;
    } else {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM messages WHERE supportToken = ? ORDER BY createdAt ASC`;
            db.all(sql, [supportToken], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }
}

// Получение последнего сообщения для токена (для Telegram)
async function getLastMessage(db, supportToken) {
    if (USE_POSTGRES) {
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

module.exports = {
    initDatabase,
    saveMessage,
    getMessages,
    getLastMessage
};

