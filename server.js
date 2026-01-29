const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ✅ ИСПРАВЛЕНИЕ 6: CORS ограничен только для разрешённых доменов
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

const io = socketIO(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ==================== БД ПОДКЛЮЧЕНИЕ ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
});

pool.on('error', (err) => {
  console.error('❌ Критическая ошибка БД:', err);
});

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(express.json());

// ==================== ИНИЦИАЛИЗАЦИЯ БД ====================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booked_dates (
        date TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ БД таблица booked_dates готова');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err.message);
    process.exit(1);
  }
}

// ✅ ИСПРАВЛЕНИЕ 5: Загрузка дат при старте
let bookedDates = [];

async function loadBookedDates() {
  try {
    const result = await pool.query(
      'SELECT date FROM booked_dates ORDER BY date ASC'
    );
    bookedDates = result.rows.map(row => row.date);
    console.log(`✅ Загружено ${bookedDates.length} забронированных дат из БД`);
  } catch (err) {
    console.error('❌ Ошибка загрузки дат:', err.message);
  }
}

// ==================== ПОДКЛЮЧЕНИЕ КЛИЕНТОВ ====================
io.on('connection', (socket) => {
  console.log('🟢 Новый клиент подключен:', socket.id);
  socket.emit('updateDates', bookedDates);

  socket.on('disconnect', () => {
    console.log('🔴 Клиент отключен:', socket.id);
  });
});

// ==================== API ENDPOINTS ====================

// GET: получить все забронированные даты
app.get('/api/booked-dates', (req, res) => {
  res.json({
    success: true,
    dates: bookedDates,
    total: bookedDates.length,
  });
});

// POST: добавить забронированную дату
app.post('/api/admin/block-date', async (req, res) => {
  try {
    // ✅ ИСПРАВЛЕНИЕ 3: Секрет из заголовков, не из body
    const secret = req.headers['x-api-secret'];

    if (secret !== process.env.API_SECRET) {
      return res.status(401).json({
        success: false,
        message: 'Неверный API ключ',
      });
    }

    const { date } = req.body;

    // ✅ ИСПРАВЛЕНИЕ 4: Санитизация и валидация даты
    if (!isValidDate(date)) {
      return res.status(400).json({
        success: false,
        message: 'Неверный формат даты (используй ДД-ММ-ГГГГ)',
      });
    }

    const sanitizedDate = date.replace(/[^0-9\-]/g, '');

    // Проверка дубликата
    if (bookedDates.includes(sanitizedDate)) {
      return res.status(400).json({
        success: false,
        message: 'Эта дата уже забронирована',
      });
    }

    // Добавляем в БД
    await pool.query(
      'INSERT INTO booked_dates (date) VALUES ($1) ON CONFLICT (date) DO NOTHING',
      [sanitizedDate]
    );

    // Добавляем в память
    bookedDates.push(sanitizedDate);
    bookedDates.sort();

    console.log(`📅 Дата заблокирована: ${sanitizedDate}`);

    // Отправляем обновление всем клиентам
    io.emit('updateDates', bookedDates);

    res.json({
      success: true,
      message: `Дата ${sanitizedDate} заблокирована`,
      dates: bookedDates,
    });
  } catch (err) {
    console.error('❌ Ошибка при добавлении даты:', err.message);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
});

// DELETE: разблокировать дату
// ✅ ИСПРАВЛЕНИЕ 10: Дата передаётся через query параметр (стандарт для DELETE)
app.delete('/api/admin/unblock-date', async (req, res) => {
  try {
    const secret = req.headers['x-api-secret'];

    if (secret !== process.env.API_SECRET) {
      return res.status(401).json({
        success: false,
        message: 'Неверный API ключ',
      });
    }

    const { date } = req.query; // ← из URL параметра

    if (!isValidDate(date)) {
      return res.status(400).json({
        success: false,
        message: 'Неверный формат даты',
      });
    }

    const sanitizedDate = date.replace(/[^0-9\-]/g, '');
    const index = bookedDates.indexOf(sanitizedDate);

    if (index === -1) {
      return res.status(400).json({
        success: false,
        message: 'Эта дата не забронирована',
      });
    }

    // Удаляем из БД
    await pool.query(
      'DELETE FROM booked_dates WHERE date = $1',
      [sanitizedDate]
    );

    // Удаляем из памяти
    bookedDates.splice(index, 1);

    console.log(`📅 Дата разблокирована: ${sanitizedDate}`);

    // Отправляем обновление
    io.emit('updateDates', bookedDates);

    res.json({
      success: true,
      message: `Дата ${sanitizedDate} разблокирована`,
      dates: bookedDates,
    });
  } catch (err) {
    console.error('❌ Ошибка при удалении даты:', err.message);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==================== HELPER FUNCTIONS ====================
function isValidDate(dateString) {
  const regex = /^\d{2}-\d{2}-\d{4}$/;
  if (!regex.test(dateString)) return false;

  const [day, month, year] = dateString.split('-');
  const dayNum = parseInt(day, 10);
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  // Проверка диапазонов
  if (monthNum < 1 || monthNum > 12) return false;
  if (dayNum < 1 || dayNum > 31) return false;
  if (yearNum < 2024 || yearNum > 2100) return false;

  // Проверка дней в месяце
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dayNum > daysInMonth[monthNum - 1]) return false;

  return true;
}

// ==================== START SERVER ====================
async function startServer() {
  try {
    await initDB();
    await loadBookedDates();

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`\n🚀 API сервер запущен на http://localhost:${PORT}`);
      console.log(`📡 WebSocket доступен на ws://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('❌ Ошибка при запуске:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io };
