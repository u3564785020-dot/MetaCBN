/**
 * Скрипт для обновления URL API в frontend файлах
 * Использование: node update-frontend-api.js <railway-url>
 * Пример: node update-frontend-api.js https://my-app.up.railway.app
 */

const fs = require('fs');
const path = require('path');

const railwayUrl = process.argv[2];

if (!railwayUrl) {
  console.error('❌ Укажите Railway URL');
  console.log('Использование: node update-frontend-api.js <railway-url>');
  console.log('Пример: node update-frontend-api.js https://my-app.up.railway.app');
  process.exit(1);
}

// Убираем trailing slash
const baseUrl = railwayUrl.replace(/\/$/, '');

const supportJsPath = path.join(__dirname, 'Meta Pay _ Meta_files', 'support.js.téléchargement');

if (!fs.existsSync(supportJsPath)) {
  console.error(`❌ Файл не найден: ${supportJsPath}`);
  process.exit(1);
}

let content = fs.readFileSync(supportJsPath, 'utf8');

// Заменяем относительные пути на абсолютные
const replacements = [
  {
    from: /axios\.post\(["']\/api\/support\/(sendMessage|sendImage|getMessages1)["']/g,
    to: (match, endpoint) => `axios.post("${baseUrl}/api/support/${endpoint}"`
  },
  {
    from: /axios\.post\("\/api\/support\/(sendMessage|sendImage|getMessages1)"/g,
    to: (match, endpoint) => `axios.post("${baseUrl}/api/support/${endpoint}"`
  }
];

let changed = false;
replacements.forEach(({ from, to }) => {
  const newContent = content.replace(from, to);
  if (newContent !== content) {
    content = newContent;
    changed = true;
  }
});

if (changed) {
  fs.writeFileSync(supportJsPath, content, 'utf8');
  console.log('✅ URL API обновлены в support.js.téléchargement');
  console.log(`   Базовый URL: ${baseUrl}`);
} else {
  console.log('⚠️  Изменений не обнаружено. Возможно, URL уже обновлены.');
}

