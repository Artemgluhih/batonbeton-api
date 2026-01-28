const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ==================== БД ПОДКЛЮЧЕНИЕ ====================
const pool = new Pool({
connectionString: process.env.DATABASE_URL || `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
});

pool.on('error', (err) => {
  console.error('❌ Ошибка БД:', err);
});

// Middleware
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);
app.use(express.json());

// Инициализация БД при старте
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      date TEXT PRIMARY KEY
    )
  `);
  console.log('✅ БД готова');
}
initDB();

// Хранилище для быстрого доступа (синхронизировано с БД)
let bookedDates = [];

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
  });
});

// POST: добавить забронированную дату
app.post('/api/admin/block-date', async (req, res) => {
  const { date, secret } = req.body;

  // Проверка секретного ключа
  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({
      success: false,
      message: 'Неверный API ключ',
    });
  }

  // Валидация даты
  if (!isValidDate(date)) {
    return res.status(400).json({
      success: false,
      message: 'Неверный формат даты (используй ДД-ММ-ГГГГ)',
    });
  }

  // Проверка дубликата в памяти
  if (bookedDates.includes(date)) {
    return res.status(400).json({
      success: false,
      message: 'Эта дата уже забронирована',
    });
  }

  try {
    // Добавляем в БД
    await pool.query(
      'INSERT INTO booked_dates (date) VALUES ($1)',
      [date]
    );

    // Добавляем в память
    bookedDates.push(date);
    bookedDates.sort();

    console.log(`📅 Дата заблокирована: ${date}`);

    // Отправляем обновление всем клиентам через Socket.io
    io.emit('updateDates', bookedDates);

    res.json({
      success: true,
      message: `Дата ${date} заблокирована`,
      dates: bookedDates,
    });
  } catch (err) {
    console.error('❌ Ошибка при добавлении даты:', err);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
    });
  }
});

// DELETE: разблокировать дату
app.delete('/api/admin/unblock-date', async (req, res) => {
  const { date, secret } = req.body;

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({
      success: false,
      message: 'Неверный API ключ',
    });
  }

  if (!isValidDate(date)) {
    return res.status(400).json({
      success: false,
      message: 'Неверный формат даты',
    });
  }

  const index = bookedDates.indexOf(date);
  if (index === -1) {
    return res.status(400).json({
      success: false,
      message: 'Эта дата не забронирована',
    });
  }

  try {
    // Удаляем из БД
    await pool.query(
      'DELETE FROM booked_dates WHERE date = $1',
      [date]
    );

    // Удаляем из памяти
    bookedDates.splice(index, 1);

    console.log(`📅 Дата разблокирована: ${date}`);

    // Отправляем обновление всем клиентам
    io.emit('updateDates', bookedDates);

    res.json({
      success: true,
      message: `Дата ${date} разблокирована`,
      dates: bookedDates,
    });
  } catch (err) {
    console.error('❌ Ошибка при удалении даты:', err);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// ==================== HELPER FUNCTIONS ====================
function isValidDate(dateString) {
  const regex = /^\d{2}-\d{2}-\d{4}$/;
  if (!regex.test(dateString)) return false;

  const [day, month, year] = dateString.split('-');
  const date = new Date(`${year}-${month}-${day}`);

  return (
    date instanceof Date &&
    !isNaN(date) &&
    parseInt(day) > 0 &&
    parseInt(day) <= 31 &&
    parseInt(month) > 0 &&
    parseInt(month) <= 12
  );
}

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 API сервер запущен на http://localhost:${PORT}`);
  console.log(`📡 WebSocket доступен на ws://localhost:${PORT}\n`);
});
