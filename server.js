const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздаем статические файлы из корневой директории
app.use(express.static(__dirname));

// Раздаем файлы из папки Meta Pay _ Meta_files
app.use('/Meta Pay _ Meta_files', express.static(path.join(__dirname, 'Meta Pay _ Meta_files')));

// Обработка корневого маршрута - отдаем главный HTML файл
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'Meta Pay _ Meta.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Файл не найден: Meta Pay _ Meta.html');
    }
});

// Обработка всех остальных маршрутов
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'Meta Pay _ Meta.html'));
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Откройте браузер и перейдите по адресу: http://localhost:${PORT}`);
});
