# Опциональный Dockerfile для Railway
# Railway может использовать Nixpacks автоматически, но Dockerfile даёт больше контроля

FROM node:18-alpine

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем код приложения
COPY . .

# Открываем порт
EXPOSE 3001

# Запускаем приложение
CMD ["node", "server.js"]

