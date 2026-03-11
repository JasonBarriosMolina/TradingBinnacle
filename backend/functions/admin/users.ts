import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { scanItems, updateItem, TABLES } from '../../lib/dynamo'
import { ok, err, getUserId } from '../../lib/lambda'
import type { User } from '../../../shared/types'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').filter(Boolean)

function isAdmin(userId: string): boolean {
  return ADMIN_IDS.includes(userId)
}

// GET /admin/users
export const list = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId || !isAdmin(userId)) return err('Acceso denegado', 403)

    const users = await scanItems<User & { PK: string; SK: string; derivToken?: string }>({
      TableName: TABLES.USERS,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'PROFILE' },
    })

    const clean = users.map(({ PK, SK, derivToken, ...u }) => u)
    return ok(clean)
  } catch (e) {
    console.error(e)
    return err('Error', 500)
  }
}

// PUT /admin/users/:userId
export const update = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const adminId = getUserId(event)
    if (!adminId || !isAdmin(adminId)) return err('Acceso denegado', 403)

    const targetUserId = event.pathParameters?.userId
    if (!targetUserId) return err('userId requerido', 400)

    const updates = JSON.parse(event.body ?? '{}') as Partial<User>
    // Strip sensitive fields
    const { userId: _u, email: _e, derivToken: _d, ...safeUpdates } = updates as Record<string, unknown>

    await updateItem(TABLES.USERS, { PK: targetUserId, SK: 'PROFILE' }, safeUpdates)
    return ok({ success: true })
  } catch (e) {
    console.error(e)
    return err('Error actualizando usuario', 500)
  }
}
