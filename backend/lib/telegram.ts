const TELEGRAM_API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw Object.assign(new Error(`Telegram API error ${res.status}: ${body}`), { statusCode: res.status })
  }
}
