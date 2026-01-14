const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
require('dotenv').config()

const token = process.env.TELEGRAM_BOT_TOKEN
const bot = new TelegramBot(token, { polling: true })

const API_URL = 'http://localhost:5000'
const API_SECRET = process.env.API_SECRET

bot.onText(/\/start/, msg => {
	const chatId = msg.chat.id
	const keyboard = {
		reply_markup: {
			keyboard: [
				[{ text: '📅 Посмотреть календарь' }],
				[{ text: '🔒 Заблокировать дату' }],
				[{ text: '🔓 Разблокировать дату' }],
			],
			resize_keyboard: true,
		},
	}

	bot.sendMessage(chatId, '👋 Добро пожаловать!', keyboard)
})

bot.on('message', async msg => {
	const chatId = msg.chat.id
	const text = msg.text

	if (text === '📅 Посмотреть календарь') {
		await handleViewCalendar(chatId)
	} else if (text === '🔒 Заблокировать дату') {
		bot.sendMessage(chatId, '📝 Введи дату: ДД-ММ-ГГГГ\n\nПример: 15-03-2025')

		bot.once('message', async msg => {
			const date = msg.text.trim()
			await handleBlockDate(chatId, date)
		})
	} else if (text === '🔓 Разблокировать дату') {
		bot.sendMessage(chatId, '📝 Введи дату: ДД-ММ-ГГГГ\n\nПример: 15-03-2025')

		bot.once('message', async msg => {
			const date = msg.text.trim()
			await handleUnblockDate(chatId, date)
		})
	}
})

async function handleViewCalendar(chatId) {
	try {
		const response = await axios.get(`${API_URL}/api/booked-dates`)
		const dates = response.data.dates

		if (dates.length === 0) {
			bot.sendMessage(chatId, '✅ Нет забронированных дат')
			return
		}

		let message = '📅 <b>Забронированные даты:</b>\n\n'
		dates.forEach((date, index) => {
			message += `${index + 1}. ${date}\n`
		})

		message += `\n<b>Всего:</b> ${dates.length}`
		bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
	} catch (error) {
		bot.sendMessage(chatId, '❌ Ошибка загрузки')
	}
}

async function handleBlockDate(chatId, date) {
	try {
		const regex = /^\d{2}-\d{2}-\d{4}$/ // ДД-МММ-ГГГГ
		if (!regex.test(date)) {
			bot.sendMessage(chatId, '❌ Неверный формат. Используй: ДД-ММ-ГГГГ')
			return
		}

		const response = await axios.post(`${API_URL}/api/admin/block-date`, {
			date: date,
			secret: API_SECRET,
		})

		if (response.data.success) {
			bot.sendMessage(chatId, `✅ Дата <b>${date}</b> заблокирована!`, {
				parse_mode: 'HTML',
			})
		}
	} catch (error) {
		const msg = error.response?.data?.message || 'Ошибка'
		bot.sendMessage(chatId, `❌ ${msg}`)
	}
}

async function handleUnblockDate(chatId, date) {
	try {
		const regex = /^\d{2}-\d{2}-\d{4}$/
		if (!regex.test(date)) {
			bot.sendMessage(chatId, '❌ Неверный формат. Используй: ДД-ММ-ГГГГ')
			return
		}

		const response = await axios.delete(`${API_URL}/api/admin/unblock-date`, {
			data: {
				date: date,
				secret: API_SECRET,
			},
		})

		if (response.data.success) {
			bot.sendMessage(chatId, `✅ Дата <b>${date}</b> разблокирована!`, {
				parse_mode: 'HTML',
			})
		}
	} catch (error) {
		const msg = error.response?.data?.message || 'Ошибка'
		bot.sendMessage(chatId, `❌ ${msg}`)
	}
}

console.log('\n🤖 Telegram Bot запущен...\n')
