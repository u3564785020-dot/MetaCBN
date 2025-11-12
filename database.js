const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Путь к базе данных
const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'chat.db');

// Инициализация базы данных
function initDatabase() {
    return new Promise((resolve, reject) => {
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

// Сохранение сообщения
function saveMessage(db, supportToken, message, image, messageFrom) {
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

// Получение всех сообщений для токена
function getMessages(db, supportToken) {
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

// Получение последнего сообщения для токена (для Telegram)
function getLastMessage(db, supportToken) {
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

module.exports = {
    initDatabase,
    saveMessage,
    getMessages,
    getLastMessage
};

