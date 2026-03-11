import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb'

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
export const db = DynamoDBDocumentClient.from(client)

export const TABLES = {
  USERS: process.env.DYNAMODB_TABLE_USERS!,
  TRADES: process.env.DYNAMODB_TABLE_TRADES!,
  SIGNALS: process.env.DYNAMODB_TABLE_SIGNALS!,
}

export async function getItem<T>(TableName: string, Key: Record<string, unknown>): Promise<T | null> {
  const res = await db.send(new GetCommand({ TableName, Key }))
  return (res.Item as T) ?? null
}

export async function putItem(TableName: string, Item: Record<string, unknown>): Promise<void> {
  await db.send(new PutCommand({ TableName, Item }))
}

export async function updateItem(
  TableName: string,
  Key: Record<string, unknown>,
  updates: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(updates)
  if (entries.length === 0) return

  // Split into SET (non-null) and REMOVE (null) entries
  const setEntries = entries.filter(([, v]) => v !== null && v !== undefined)
  const removeEntries = entries.filter(([, v]) => v === null || v === undefined)

  const parts: string[] = []
  const ExpressionAttributeNames: Record<string, string> = {}
  const ExpressionAttributeValues: Record<string, unknown> = {}

  if (setEntries.length > 0) {
    setEntries.forEach(([k, v], i) => {
      ExpressionAttributeNames[`#s${i}`] = k
      ExpressionAttributeValues[`:s${i}`] = v
    })
    parts.push('SET ' + setEntries.map((_, i) => `#s${i} = :s${i}`).join(', '))
  }

  if (removeEntries.length > 0) {
    removeEntries.forEach(([k], i) => {
      ExpressionAttributeNames[`#r${i}`] = k
    })
    parts.push('REMOVE ' + removeEntries.map((_, i) => `#r${i}`).join(', '))
  }

  await db.send(new UpdateCommand({
    TableName,
    Key,
    UpdateExpression: parts.join(' '),
    ExpressionAttributeNames,
    ...(Object.keys(ExpressionAttributeValues).length > 0 ? { ExpressionAttributeValues } : {}),
  }))
}

export async function deleteItem(TableName: string, Key: Record<string, unknown>): Promise<void> {
  await db.send(new DeleteCommand({ TableName, Key }))
}

export async function queryItems<T>(params: QueryCommandInput): Promise<T[]> {
  const res = await db.send(new QueryCommand(params))
  return (res.Items ?? []) as T[]
}

export async function scanItems<T>(params: ScanCommandInput): Promise<T[]> {
  const res = await db.send(new ScanCommand(params))
  return (res.Items ?? []) as T[]
}
