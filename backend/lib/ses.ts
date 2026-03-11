import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const FROM = process.env.SES_FROM_EMAIL!
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? '30')
const MONTHLY_PRICE = process.env.MONTHLY_PRICE_USD ?? '3.99'
const SINPE = process.env.BANK_INFO_SINPE ?? ''
const CUENTA = process.env.BANK_INFO_CUENTA ?? ''

export async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `¡Bienvenido a SYNTRA, ${name}! 🚀` },
      Body: {
        Html: {
          Data: `
            <div style="font-family: monospace; background:#0D1117; color:#E6EDF3; padding:32px; border-radius:8px; max-width:560px; margin:0 auto;">
              <h1 style="color:#388BFD; margin-bottom:8px;">SYNTRA</h1>
              <p>Hola <strong>${name}</strong>,</p>
              <p>Tu cuenta está activa con <strong style="color:#388BFD;">${TRIAL_DAYS} días de prueba gratuita</strong> del Plan Pro completo.</p>
              <h3 style="color:#388BFD; margin-top:24px;">Próximos pasos:</h3>
              <ol>
                <li>Conecta tu cuenta Deriv en Ajustes</li>
                <li>Sincroniza tu historial de trades</li>
                <li>Configura tus índices a monitorear</li>
              </ol>
              <div style="margin-top:32px; padding:16px; background:#161B22; border:1px solid #21262D; border-radius:6px;">
                <h3 style="color:#D29922; margin:0 0 12px;">Datos de pago (al vencer tu trial)</h3>
                <p style="margin:4px 0;">Precio mensual: <strong style="color:#E6EDF3;">$${MONTHLY_PRICE}</strong></p>
                ${SINPE ? `<p style="margin:4px 0;">SINPE Móvil: <strong style="color:#E6EDF3;">${SINPE}</strong></p>` : ''}
                ${CUENTA ? `<p style="margin:4px 0;">IBAN: <strong style="color:#E6EDF3; font-size:13px;">${CUENTA}</strong></p>` : ''}
                <p style="font-size:12px; color:#7D8590; margin-top:8px;">Activación manual en 24h hábiles tras confirmación del pago.</p>
              </div>
            </div>
          `,
        },
      },
    },
  }))
}

export async function sendTrialExpiringEmail(email: string, name: string, daysLeft: number): Promise<void> {
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Tu trial de SYNTRA vence en ${daysLeft} días` },
      Body: {
        Html: {
          Data: `
            <div style="font-family:monospace; background:#0D1117; color:#E6EDF3; padding:32px; border-radius:8px; max-width:560px;">
              <h1 style="color:#D29922;">⏳ Trial por vencer</h1>
              <p>Hola ${name}, tu período de prueba gratuita vence en <strong>${daysLeft} días</strong>.</p>
              <p>Para continuar, realiza tu pago de <strong>$${MONTHLY_PRICE}/mes</strong>:</p>
              ${SINPE ? `<p>SINPE: <strong>${SINPE}</strong></p>` : ''}
              ${CUENTA ? `<p>IBAN: <strong>${CUENTA}</strong></p>` : ''}
            </div>
          `,
        },
      },
    },
  }))
}
