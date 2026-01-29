const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

// ✅ ИСПРАВЛЕНИЕ 1 & 2: Переменные окружения для всех данных
const token = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = process.env.API_URL || 'http://localhost:5000';
const API_SECRET = process.env.API_SECRET;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN не установлен');
  process.exit(1);
}

// ✅ ИСПРАВЛЕНИЕ 6: Настройка timeout для axios
const axiosInstance = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ✅ ИСПРАВЛЕНИЕ 8: Rate limiting
const userRequestTimestamps = new Map();
const RATE_LIMIT_WINDOW = 60000; // 60 секунд
const MAX_REQUESTS_PER_WINDOW = 5;

function isRateLimited(userId) {
  const now = Date.now();
  if (!userRequestTimestamps.has(userId)) {
    userRequestTimestamps.set(userId, []);
  }

  const timestamps = userRequestTimestamps.get(userId);
  const recentTimestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);

  if (recentTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  recentTimestamps.push(now);
  userRequestTimestamps.set(userId, recentTimestamps);
  return false;
}

// ✅ ИСПРАВЛЕНИЕ 9: Проверка длины входных данных
function validateInput(input, maxLength = 100) {
  if (!input || typeof input !== 'string') return false;
  if (input.trim().length === 0) return false;
  if (input.length > maxLength) return false;
  return true;
}

// ✅ ИСПРАВЛЕНИЕ 3: Правильная валидация даты
function isValidDate(dateString) {
  const regex = /^(\d{2})-(\d{2})-(\d{4})$/;
  const match = dateString.match(regex);

  if (!match) return false;

  const [, day, month, year] = match;
  const dayNum = parseInt(day, 10);
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  // Проверка диапазонов
  if (monthNum < 1 || monthNum > 12) return false;
  if (dayNum < 1 || dayNum > 31) return false;
  if (yearNum < 2024 || yearNum > 2100) return false;

  // Дополнительная проверка для месяцев
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dayNum > daysInMonth[monthNum - 1]) return false;

  return true;
}

// ✅ ИСПРАВЛЕНИЕ 7: Детальные ошибки в логи, безопасные сообщения пользователю
function getErrorMessage(error) {
  console.error('API Error:', error.message);

  if (error.response?.status === 401) {
    return '❌ Ошибка аутентификации. Проверьте учетные данные.';
  }
  if (error.response?.status === 403) {
    return '❌ Доступ запрещен.';
  }
  if (error.response?.status === 400) {
    return `❌ Неверный запрос: ${error.response.data?.message || 'неизвестная ошибка'}`;
  }
  if (error.code === 'ECONNABORTED') {
    return '❌ Время ожидания истекло. Попробуйте позже.';
  }
  if (error.message === 'Network Error') {
    return '❌ Ошибка сети. Проверьте подключение.';
  }

  return '❌ Произошла ошибка при обработке запроса. Попробуйте позже.';
}

// ✅ ИСПРАВЛЕНИЕ 5: Безопасное управление сессиями
const userSessions = new Map();

const bot = new TelegramBot(token, { polling: true });

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (isRateLimited(chatId)) {
    bot.sendMessage(chatId, '⏱️ Вы отправляете слишком много запросов. Пожалуйста, подождите.');
    return;
  }

  const keyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '📅 Посмотреть календарь' }],
        [{ text: '🔒 Заблокировать дату' }],
        [{ text: '🔓 Разблокировать дату' }],
      ],
      resize_keyboard: true,
    },
  };

  bot.sendMessage(chatId, '👋 Добро пожаловать в BatonBeton!\n\nВыберите действие:', keyboard);
});

// Основной обработчик сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!validateInput(text)) {
    bot.sendMessage(chatId, '❌ Неверный ввод. Пожалуйста, проверьте данные.');
    return;
  }

  if (isRateLimited(chatId)) {
    bot.sendMessage(chatId, '⏱️ Вы отправляете слишком много запросов. Пожалуйста, подождите.');
    return;
  }

  // Проверка текущей сессии пользователя
  if (userSessions.has(chatId)) {
    const session = userSessions.get(chatId);
    userSessions.delete(chatId);

    if (session.action === 'block_date') {
      await handleBlockDate(chatId, text);
    } else if (session.action === 'unblock_date') {
      await handleUnblockDate(chatId, text);
    }
    return;
  }

  // Основной обработчик команд
  if (text === '📅 Посмотреть календарь') {
    await handleViewCalendar(chatId);
  } else if (text === '🔒 Заблокировать дату') {
    userSessions.set(chatId, { action: 'block_date' });
    bot.sendMessage(chatId, '📝 Введи дату в формате: ДД-ММ-ГГГГ\n\nПример: 15-03-2025');
  } else if (text === '🔓 Разблокировать дату') {
    userSessions.set(chatId, { action: 'unblock_date' });
    bot.sendMessage(chatId, '📝 Введи дату в формате: ДД-ММ-ГГГГ\n\nПример: 15-03-2025');
  } else {
    bot.sendMessage(chatId, '❓ Не распознал команду. Используй кнопки меню.');
  }
});

// Просмотр календаря
async function handleViewCalendar(chatId) {
  try {
    const response = await axiosInstance.get(`${API_URL}/api/booked-dates`);
    const dates = response.data.dates || [];

    if (dates.length === 0) {
      bot.sendMessage(chatId, '✅ Нет забронированных дат. Календарь свободен!');
      return;
    }

    let message = '📅 <b>Забронированные даты:</b>\n\n';
    dates.forEach((date, index) => {
      message += `${index + 1}. ${date}\n`;
    });
    message += `\n<b>Всего:</b> ${dates.length} ${dates.length === 1 ? 'дата' : 'дат'}`;

    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    bot.sendMessage(chatId, errorMsg);
  }
}

// Блокировка даты
async function handleBlockDate(chatId, date) {
  try {
    // ✅ ИСПРАВЛЕНИЕ 3: Проверка валидности даты
    if (!isValidDate(date)) {
      bot.sendMessage(
        chatId,
        '❌ Неверный формат даты. Используйте: ДД-ММ-ГГГГ (например, 15-03-2025)'
      );
      return;
    }

    // ✅ ИСПРАВЛЕНИЕ 4: Санитизация входных данных
    const sanitizedDate = date.replace(/[^0-9\-]/g, '');

    // ✅ ИСПРАВЛЕНИЕ 10: Передача секрета через заголовки
    const response = await axiosInstance.post(
      `${API_URL}/api/admin/block-date`,
      { date: sanitizedDate },
      { headers: { 'X-API-Secret': API_SECRET } }
    );

    if (response.data.success) {
      bot.sendMessage(chatId, `✅ Дата <b>${sanitizedDate}</b> успешно заблокирована!`, {
        parse_mode: 'HTML',
      });
    } else {
      bot.sendMessage(chatId, '❌ Не удалось заблокировать дату. Попробуйте позже.');
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    bot.sendMessage(chatId, errorMsg);
  }
}

// Разблокировка даты
async function handleUnblockDate(chatId, date) {
  try {
    // ✅ ИСПРАВЛЕНИЕ 3: Проверка валидности даты
    if (!isValidDate(date)) {
      bot.sendMessage(
        chatId,
        '❌ Неверный формат даты. Используйте: ДД-ММ-ГГГГ (например, 15-03-2025)'
      );
      return;
    }

    // ✅ ИСПРАВЛЕНИЕ 4: Санитизация входных данных
    const sanitizedDate = date.replace(/[^0-9\-]/g, '');

    // ✅ ИСПРАВЛЕНИЕ 10: Передача секрета через заголовки (DELETE с query параметром)
    const response = await axiosInstance.delete(
      `${API_URL}/api/admin/unblock-date?date=${sanitizedDate}`,
      { headers: { 'X-API-Secret': API_SECRET } }
    );

    if (response.data.success) {
      bot.sendMessage(chatId, `✅ Дата <b>${sanitizedDate}</b> успешно разблокирована!`, {
        parse_mode: 'HTML',
      });
    } else {
      bot.sendMessage(chatId, '❌ Не удалось разблокировать дату. Попробуйте позже.');
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    bot.sendMessage(chatId, errorMsg);
  }
}

// Логирование ошибок при отключении polling
bot.on('polling_error', (error) => {
  console.error('❌ Polling ошибка:', error.message);
});

console.log('\n🤖 Telegram Bot запущен и слушает запросы...\n');

module.exports = bot;
