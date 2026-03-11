import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { queryItems, updateItem, TABLES } from '../../lib/dynamo'
import { ok, err, getUserId } from '../../lib/lambda'
import type { Signal, IndexSymbol } from '../../../shared/types'

// GET /signals — last 24h signals for Pro users
export const list = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

    const signals = await queryItems<Signal & { PK: string; SK: string }>({
      TableName: TABLES.SIGNALS,
      KeyConditionExpression: 'PK = :pk AND SK >= :since',
      ExpressionAttributeValues: { ':pk': 'SIGNAL', ':since': since },
      ScanIndexForward: false,
      Limit: 50,
    })

    const clean = signals.map(({ PK, SK, ...s }) => s)
    return ok(clean)
  } catch (e) {
    console.error(e)
    return err('Error obteniendo señales', 500)
  }
}

// PUT /signals/watchlist
export const updateWatchlist = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const { watchlist } = JSON.parse(event.body ?? '{}') as { watchlist: IndexSymbol[] }
    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, { watchlist })
    return ok({ success: true })
  } catch {
    return err('Error', 500)
  }
}

// POST /signals/push-subscription
export const savePushSub = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const subscription = JSON.parse(event.body ?? '{}')
    await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, { pushSubscription: subscription })
    return ok({ success: true })
  } catch {
    return err('Error', 500)
  }
}
