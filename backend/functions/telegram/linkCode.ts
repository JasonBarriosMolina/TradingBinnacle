import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { updateItem, TABLES } from '../../lib/dynamo'
import { ok, err, getUserId } from '../../lib/lambda'

function generateCode(length = 8): string {
  // Avoids ambiguous chars like 0/O, 1/I/l
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// GET /telegram/link-code — generate a 10-minute code to link a Telegram account
export const getLinkCode = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, {
      telegramLinkCode: code,
      telegramLinkCodeExpires: expiresAt,
    })

    return ok({
      code,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      expiresAt,
    })
  } catch {
    return err('Error generando código', 500)
  }
}

// DELETE /telegram/disconnect — remove Telegram link from the user's account
export const disconnectTelegram = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, {
      telegramChatId: null,
      telegramLinkCode: null,
      telegramLinkCodeExpires: null,
    })

    return ok({ success: true })
  } catch {
    return err('Error', 500)
  }
}
