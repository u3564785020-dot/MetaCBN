const fs = require('fs').promises;
const path = require('path');

const KEY_FILE = path.join(__dirname, 'smartsupp_key.json');
const HTML_FILE = path.join(__dirname, 'Meta Pay _ Meta.html');

class SmartsuppKeyManager {
    constructor() {
        this.currentKey = null;
    }

    // Загрузка ключа из файла
    async loadKey() {
        try {
            const data = await fs.readFile(KEY_FILE, 'utf8');
            const json = JSON.parse(data);
            this.currentKey = json.key || null;
            console.log('✅ [SMARTSUPP KEY] Ключ загружен из файла');
            return this.currentKey;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Файл не существует, попробуем загрузить из HTML
                console.log('⚠️ [SMARTSUPP KEY] Файл ключа не найден, загружаю из HTML...');
                return await this.loadKeyFromHTML();
            }
            console.error('❌ [SMARTSUPP KEY] Ошибка загрузки ключа:', error.message);
            return null;
        }
    }

    // Загрузка ключа из HTML файла
    async loadKeyFromHTML() {
        try {
            const html = await fs.readFile(HTML_FILE, 'utf8');
            const match = html.match(/_smartsupp\.key\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1]) {
                this.currentKey = match[1];
                // Сохраняем в файл для будущего использования
                await this.saveKeyToFile(this.currentKey);
                console.log('✅ [SMARTSUPP KEY] Ключ загружен из HTML и сохранен в файл');
                return this.currentKey;
            }
            console.warn('⚠️ [SMARTSUPP KEY] Ключ не найден в HTML');
            return null;
        } catch (error) {
            console.error('❌ [SMARTSUPP KEY] Ошибка загрузки из HTML:', error.message);
            return null;
        }
    }

    // Сохранение ключа в файл
    async saveKeyToFile(key) {
        try {
            await fs.writeFile(KEY_FILE, JSON.stringify({ key, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
            this.currentKey = key;
            console.log('✅ [SMARTSUPP KEY] Ключ сохранен в файл');
            return true;
        } catch (error) {
            console.error('❌ [SMARTSUPP KEY] Ошибка сохранения в файл:', error.message);
            return false;
        }
    }

    // Обновление ключа в HTML файле
    async updateKeyInHTML(newKey) {
        try {
            let html = await fs.readFile(HTML_FILE, 'utf8');
            
            // Сохраняем старый ключ для проверки
            const oldMatch = html.match(/_smartsupp\.key\s*=\s*['"]([^'"]+)['"]/);
            const oldKey = oldMatch ? oldMatch[1] : null;
            
            // Заменяем старый ключ на новый (поддерживаем оба формата кавычек)
            // Ищем и заменяем независимо от типа кавычек
            html = html.replace(
                /(_smartsupp\.key\s*=\s*)(['"])[^'"]*\2/,
                `$1'${newKey}'`
            );
            
            await fs.writeFile(HTML_FILE, html, 'utf8');
            
            // ПРОВЕРКА: Читаем файл обратно и проверяем, что ключ действительно изменился
            const verifyHtml = await fs.readFile(HTML_FILE, 'utf8');
            const verifyMatch = verifyHtml.match(/_smartsupp\.key\s*=\s*['"]([^'"]+)['"]/);
            const verifyKey = verifyMatch ? verifyMatch[1] : null;
            
            if (verifyKey !== newKey) {
                console.error(`❌ [SMARTSUPP KEY] ОШИБКА ПРОВЕРКИ: Ожидался ключ "${newKey}", но в файле "${verifyKey}"`);
                throw new Error(`Проверка не прошла: ключ в файле не соответствует установленному`);
            }
            
            this.currentKey = newKey;
            await this.saveKeyToFile(newKey);
            console.log(`✅ [SMARTSUPP KEY] Ключ обновлен в HTML файле: "${oldKey}" -> "${newKey}"`);
            console.log(`✅ [SMARTSUPP KEY] Проверка пройдена: ключ в файле = "${verifyKey}"`);
            return { success: true, oldKey, newKey: verifyKey };
        } catch (error) {
            console.error('❌ [SMARTSUPP KEY] Ошибка обновления HTML:', error.message);
            return { success: false, error: error.message };
        }
    }

    // Получение текущего ключа
    async getCurrentKey() {
        if (this.currentKey) {
            return this.currentKey;
        }
        return await this.loadKey();
    }

    // Установка нового ключа
    async setKey(newKey) {
        if (!newKey || typeof newKey !== 'string' || newKey.trim().length === 0) {
            throw new Error('Ключ не может быть пустым');
        }

        const trimmedKey = newKey.trim();
        
        // Обновляем в HTML
        const result = await this.updateKeyInHTML(trimmedKey);
        
        if (!result || !result.success) {
            throw new Error(result?.error || 'Не удалось обновить ключ в HTML файле');
        }

        return result;
    }

    // Проверка текущего ключа в HTML файле (для верификации)
    async verifyKeyInFile() {
        try {
            const html = await fs.readFile(HTML_FILE, 'utf8');
            const match = html.match(/_smartsupp\.key\s*=\s*['"]([^'"]+)['"]/);
            const fileKey = match ? match[1] : null;
            
            // Также проверяем файл ключа
            let savedKey = null;
            try {
                const keyData = await fs.readFile(KEY_FILE, 'utf8');
                const json = JSON.parse(keyData);
                savedKey = json.key || null;
            } catch (e) {
                // Файл ключа может не существовать
            }
            
            return {
                htmlFile: fileKey,
                savedFile: savedKey,
                memory: this.currentKey,
                allMatch: fileKey === savedKey && savedKey === this.currentKey
            };
        } catch (error) {
            return {
                error: error.message,
                htmlFile: null,
                savedFile: null,
                memory: this.currentKey,
                allMatch: false
            };
        }
    }
}

// Создаем singleton экземпляр
const keyManager = new SmartsuppKeyManager();

// Инициализируем при загрузке модуля
keyManager.loadKey().catch(err => {
    console.error('❌ [SMARTSUPP KEY] Ошибка инициализации:', err.message);
});

module.exports = keyManager;

