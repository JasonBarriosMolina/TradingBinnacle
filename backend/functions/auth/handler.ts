import type { APIGatewayProxyHandlerV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { createCognitoUser, loginCognitoUser, refreshCognitoToken, forgotPassword, confirmResetPassword, encryptToken } from '../../lib/auth'
import { putItem, getItem, updateItem, TABLES } from '../../lib/dynamo'
import { sendWelcomeEmail } from '../../lib/ses'
import { ok, err, getUserId } from '../../lib/lambda'
import { provisionAccount, deleteAccount } from '../../lib/metaapi'
import type { User } from '../../../shared/types'

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? '30')
const MONTHLY_PRICE = parseFloat(process.env.MONTHLY_PRICE_USD ?? '3.99')

// POST /auth/register  (no auth required)
export const register: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { name, email, password } = JSON.parse(event.body ?? '{}')
    if (!name || !email || !password) return err('Faltan campos requeridos')

    const userId = await createCognitoUser(email, password, name)
    const now = new Date()
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86_400_000)

    const user: User = {
      userId,
      email,
      name,
      plan: 'pro',
      status: 'trial',
      trialEndsAt: trialEnd.toISOString(),
      subscriptionPrice: MONTHLY_PRICE,
      createdAt: now.toISOString(),
      watchlist: [
        'CRASH_300', 'CRASH_500', 'CRASH_600', 'CRASH_900', 'CRASH_1000',
        'BOOM_300',  'BOOM_500',  'BOOM_600',  'BOOM_900',  'BOOM_1000',
      ],
    }

    await putItem(TABLES.USERS, { ...user, PK: userId, SK: 'PROFILE' })
    await sendWelcomeEmail(email, name)
    return ok({ success: true }, 201)
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : 'Error desconocido')
  }
}

// POST /auth/login  (no auth required)
export const login: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { email, password } = JSON.parse(event.body ?? '{}')
    if (!email || !password) return err('Faltan credenciales')

    const tokens = await loginCognitoUser(email, password)
    const payload = JSON.parse(Buffer.from(tokens.idToken.split('.')[1], 'base64').toString()) as { sub: string }
    const userId = payload.sub

    const user = await getItem<User & { PK: string; SK: string }>(TABLES.USERS, { PK: userId, SK: 'PROFILE' })
    if (!user) return err('Usuario no encontrado', 404)

    if (user.status === 'trial' && new Date(user.trialEndsAt) < new Date()) {
      await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, { status: 'pending', plan: 'free' })
      user.status = 'pending'
      user.plan = 'free'
    }

    const { PK: _pk, SK: _sk, ...cleanUser } = user
    return ok({ ...tokens, user: cleanUser })
  } catch {
    return err('Credenciales incorrectas', 401)
  }
}

// POST /auth/forgot-password  (no auth required)
export const forgotPw: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { email } = JSON.parse(event.body ?? '{}')
    await forgotPassword(email)
    return ok({ success: true })
  } catch {
    return err('No se pudo enviar el código')
  }
}

// POST /auth/confirm-reset-password  (no auth required)
export const confirmReset: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { email, code, newPassword } = JSON.parse(event.body ?? '{}')
    await confirmResetPassword(email, code, newPassword)
    return ok({ success: true })
  } catch {
    return err('Código inválido o expirado')
  }
}

// POST /auth/deriv-token  (JWT required)
export const saveDerivToken = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const { derivToken, derivLoginId, derivAccountType } = JSON.parse(event.body ?? '{}') as {
      derivToken: string; derivLoginId: string; derivAccountType: string
    }
    const encrypted = encryptToken(derivToken)
    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, { derivToken: encrypted, derivLoginId, derivAccountType })
    return ok({ success: true })
  } catch {
    return err('Error guardando token', 500)
  }
}

// DELETE /auth/deriv-token  (JWT required)
export const deleteDerivToken = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)
    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, {
      derivToken: null,
      derivLoginId: null,
      derivAccountType: null,
    })
    return ok({ success: true })
  } catch (e) {
    console.error('[deleteDerivToken] error:', e)
    return err('Error', 500)
  }
}

// Dispatcher: POST → saveDerivToken, DELETE → deleteDerivToken
export const derivTokenHandler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (event.requestContext.http.method === 'DELETE') {
    return deleteDerivToken(event)
  }
  return saveDerivToken(event)
}

// POST /auth/mt5-credentials  (JWT required)
// Provisions a MetaApi account for the user's MT5 login.
// The password is used only for provisioning and is NOT stored.
export const saveMt5Credentials = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const { login, password, server } = JSON.parse(event.body ?? '{}') as {
      login: string; password: string; server: string
    }
    if (!login || !password || !server) return err('Faltan campos: login, password, server')

    const user = await getItem<User & { PK: string; SK: string }>(
      TABLES.USERS, { PK: userId, SK: 'PROFILE' },
    )
    if (!user) return err('Usuario no encontrado', 404)

    // If account already exists in MetaApi, delete it first (re-connect flow)
    if (user.metaApiAccountId) {
      try { await deleteAccount(user.metaApiAccountId) } catch { /* ignore if already deleted */ }
    }

    const mt5AccountType = server.toLowerCase().includes('demo') ? 'demo' : 'real'
    const accountName    = `${user.name} ${mt5AccountType.toUpperCase()}`
    const metaApiAccountId = await provisionAccount(login, password, server, accountName)

    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, {
      metaApiAccountId,
      mt5LoginId:      login,
      mt5Server:       server,
      mt5AccountType,
    })

    return ok({ metaApiAccountId, mt5LoginId: login, mt5Server: server, mt5AccountType })
  } catch (e) {
    console.error('[saveMt5Credentials] error:', e)
    return err(e instanceof Error ? e.message : 'Error conectando MT5', 500)
  }
}

// Dispatcher: POST → saveMt5Credentials, DELETE → deleteMt5Credentials
export const mt5CredentialsHandler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (event.requestContext.http.method === 'DELETE') {
    return deleteMt5Credentials(event)
  }
  return saveMt5Credentials(event)
}

// DELETE /auth/mt5-credentials  (JWT required)
export const deleteMt5Credentials = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const user = await getItem<User & { PK: string; SK: string }>(
      TABLES.USERS, { PK: userId, SK: 'PROFILE' },
    )
    if (user?.metaApiAccountId) {
      try { await deleteAccount(user.metaApiAccountId) } catch { /* ignore */ }
    }

    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, {
      metaApiAccountId: null,
      mt5LoginId:       null,
      mt5Server:        null,
      mt5AccountType:   null,
      mt5LastSync:      null,
    })
    return ok({ success: true })
  } catch (e) {
    console.error('[deleteMt5Credentials] error:', e)
    return err('Error desconectando MT5', 500)
  }
}

// POST /auth/refresh-token  (no auth required — takes refreshToken, returns new tokens)
export const refreshToken: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const { refreshToken: token } = JSON.parse(event.body ?? '{}')
    if (!token) return err('refreshToken requerido')
    const tokens = await refreshCognitoToken(token)
    return ok(tokens)
  } catch {
    return err('Sesión expirada, inicia sesión de nuevo', 401)
  }
}

// GET /auth/me  (JWT required)
export const getMe = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const user = await getItem<User & { PK: string; SK: string; derivToken?: string }>(
      TABLES.USERS, { PK: userId, SK: 'PROFILE' },
    )
    if (!user) return err('No encontrado', 404)

    // Strip internal fields (encrypted tokens, DynamoDB keys)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PK: _pk, SK: _sk, derivToken: _dt, ...cleanUser } = user
    return ok(cleanUser)
  } catch {
    return err('Error', 500)
  }
}
