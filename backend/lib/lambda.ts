import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'

// Typed handler for JWT-authorized routes
export type AuthHandler = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
) => Promise<APIGatewayProxyResultV2>

// Extract userId from JWT claims
export function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string | null {
  return (event.requestContext.authorizer?.jwt?.claims?.sub as string) ?? null
}

export function ok(body: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  }
}

export function err(message: string, statusCode = 400): APIGatewayProxyResultV2 {
  return ok({ error: message }, statusCode)
}
