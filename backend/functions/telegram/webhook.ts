import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { scanItems, updateItem, TABLES } from '../../lib/dynamo'
import { sendTelegramMessage } from '../../lib/telegram'
import type { User } from '../../../shared/types'

// Telegram sends POST updates to this endpoint.
// Auth is done via X-Telegram-Bot-Api-Secret-Token header (set when registering the webhook).
export const handler = async (event: APIGatewayProxyEventV2) => {
  const secret = event.headers['x-telegram-bot-api-secret-token']
  if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return { statusCode: 403, body: 'Forbidden' }
  }

  let update: { message?: { chat: { id: number }; text?: string } }
  try {
    update = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 200, body: 'ok' }
  }

  const message = update.message
  if (!message?.text) return { statusCode: 200, body: 'ok' }

  const chatId = message.chat.id
  const text = message.text.trim()

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1]?.trim()

    if (!code) {
      await sendTelegramMessage(
        chatId,
        '👋 <b>SYNTRA</b>\n\nPara vincular tu cuenta, ve a <b>Ajustes → Telegram</b> dentro de la app y sigue los pasos.',
      )
      return { statusCode: 200, body: 'ok' }
    }

    const now = new Date().toISOString()
    const allUsers = await scanItems<User & { PK: string }>({ TableName: TABLES.USERS })
    const user = allUsers.find(
      (u) => u.telegramLinkCode === code && u.telegramLinkCodeExpires && u.telegramLinkCodeExpires > now,
    )

    if (!user) {
      await sendTelegramMessage(chatId, '❌ Código inválido o expirado. Genera uno nuevo desde Ajustes en SYNTRA.')
      return { statusCode: 200, body: 'ok' }
    }

    await updateItem(TABLES.USERS, { PK: user.PK, SK: 'PROFILE' }, {
      telegramChatId: String(chatId),
      telegramLinkCode: null,
      telegramLinkCodeExpires: null,
    })

    await sendTelegramMessage(
      chatId,
      `✅ <b>¡Cuenta vinculada!</b>\n\nAhora recibirás las señales de trading de SYNTRA en este chat.\n\n👤 ${user.email}\n\nEnvía /stop para desvincular.`,
    )
  } else if (text === '/stop') {
    const allUsers = await scanItems<User & { PK: string }>({ TableName: TABLES.USERS })
    const user = allUsers.find((u) => u.telegramChatId === String(chatId))

    if (user) {
      await updateItem(TABLES.USERS, { PK: user.PK, SK: 'PROFILE' }, { telegramChatId: null })
      await sendTelegramMessage(chatId, '🔕 Telegram desvinculado. Ya no recibirás señales de SYNTRA.')
    } else {
      await sendTelegramMessage(chatId, 'No hay ninguna cuenta de SYNTRA vinculada a este chat.')
    }
  }

  return { statusCode: 200, body: 'ok' }
}
