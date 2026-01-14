const express = require('express')
const http = require('http')
const socketIO = require('socket.io')
const cors = require('cors')
require('dotenv').config()

const app = express()
const server = http.createServer(app)
const io = socketIO(server, {
	cors: {
		origin: '*',
		methods: ['GET', 'POST'],
	},
})

// Middleware
app.use(
	cors({
		origin: '*', // Разрешить все источники (временно для тестирования!)
		methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
		credentials: true,
	})
)
app.use(express.json())

// Хранилище забронированных дат (в production используй БД!)
let bookedDates = []

// Подключение клиентов
io.on('connection', socket => {
	console.log('🟢 Новый клиент подключен:', socket.id)

	// Отправляем актуальные даты при подключении
	socket.emit('updateDates', bookedDates)

	socket.on('disconnect', () => {
		console.log('🔴 Клиент отключен:', socket.id)
	})
})

// ==================== API ENDPOINTS ====================

// GET: получить все забронированные даты
app.get('/api/booked-dates', (req, res) => {
	res.json({
		success: true,
		dates: bookedDates,
	})
})

// POST: добавить забронированную дату
app.post('/api/admin/block-date', (req, res) => {
	const { date, secret } = req.body

	// Проверка секретного ключа
	if (secret !== process.env.API_SECRET) {
		return res.status(401).json({
			success: false,
			message: 'Неверный API ключ',
		})
	}

	// Валидация даты
	if (!isValidDate(date)) {
		return res.status(400).json({
			success: false,
			message: 'Неверный формат даты (используй YYYY-MM-DD)',
		})
	}

	// Проверка дубликата
	if (bookedDates.includes(date)) {
		return res.status(400).json({
			success: false,
			message: 'Эта дата уже забронирована',
		})
	}

	// Добавляем дату
	bookedDates.push(date)
	bookedDates.sort()

	console.log(`📅 Дата заблокирована: ${date}`)

	// Отправляем обновление всем подключенным клиентам
	io.emit('updateDates', bookedDates)

	res.json({
		success: true,
		message: `Дата ${date} заблокирована`,
		dates: bookedDates,
	})
})

// DELETE: разблокировать дату
app.delete('/api/admin/unblock-date', (req, res) => {
	const { date, secret } = req.body

	if (secret !== process.env.API_SECRET) {
		return res.status(401).json({
			success: false,
			message: 'Неверный API ключ',
		})
	}

	if (!isValidDate(date)) {
		return res.status(400).json({
			success: false,
			message: 'Неверный формат даты',
		})
	}

	const index = bookedDates.indexOf(date)
	if (index === -1) {
		return res.status(400).json({
			success: false,
			message: 'Эта дата не забронирована',
		})
	}

	bookedDates.splice(index, 1)

	console.log(`📅 Дата разблокирована: ${date}`)

	// Отправляем обновление всем клиентам
	io.emit('updateDates', bookedDates)

	res.json({
		success: true,
		message: `Дата ${date} разблокирована`,
		dates: bookedDates,
	})
})

// Health check
app.get('/health', (req, res) => {
	res.json({ status: 'OK' })
})

// ==================== HELPER FUNCTIONS ====================

function isValidDate(dateString) {
	// Формат: ДД-МММ-ГГГГ
	const regex = /^\d{2}-\d{2}-\d{4}$/
	if (!regex.test(dateString)) return false

	const [day, month, year] = dateString.split('-')
	const date = new Date(`${year}-${month}-${day}`)

	return (
		date instanceof Date &&
		!isNaN(date) &&
		parseInt(day) > 0 &&
		parseInt(day) <= 31 &&
		parseInt(month) > 0 &&
		parseInt(month) <= 12
	)
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
	console.log(`\n🚀 API сервер запущен на http://localhost:${PORT}`)
	console.log(`📡 WebSocket доступен на ws://localhost:${PORT}\n`)
})
