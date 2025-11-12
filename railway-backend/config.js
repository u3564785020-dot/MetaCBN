// Конфигурация для frontend
// Этот файл можно использовать для настройки URL API

const API_CONFIG = {
  // Замените на ваш Railway URL после деплоя
  BASE_URL: process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : 'https://your-app-name.up.railway.app',
  
  ENDPOINTS: {
    SEND_MESSAGE: '/api/support/sendMessage',
    SEND_IMAGE: '/api/support/sendImage',
    GET_MESSAGES: '/api/support/getMessages1'
  }
};

module.exports = API_CONFIG;

