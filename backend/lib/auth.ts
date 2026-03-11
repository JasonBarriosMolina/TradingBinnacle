import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  type AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider'

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!

export async function createCognitoUser(email: string, password: string, name: string): Promise<string> {
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    TemporaryPassword: password + '_Tmp1!',
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'name', Value: name },
      { Name: 'email_verified', Value: 'true' },
    ],
    MessageAction: 'SUPPRESS',
  }))

  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    Password: password,
    Permanent: true,
  }))

  const res = await cognito.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
  }))
  const sub = res.UserAttributes?.find((a: { Name?: string; Value?: string }) => a.Name === 'sub')?.Value
  if (!sub) throw new Error('No sub found')
  return sub
}

export async function loginCognitoUser(
  email: string,
  password: string,
): Promise<{ accessToken: string; idToken: string; refreshToken: string }> {
  const res = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH' as AuthFlowType,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }))

  const result = res.AuthenticationResult
  if (!result?.AccessToken || !result?.IdToken || !result?.RefreshToken) throw new Error('Auth failed')
  return { accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken }
}

export async function refreshCognitoToken(
  refreshToken: string,
): Promise<{ accessToken: string; idToken: string }> {
  const res = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
    AuthFlow: 'REFRESH_TOKEN_AUTH' as AuthFlowType,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  }))

  const result = res.AuthenticationResult
  if (!result?.AccessToken || !result?.IdToken) throw new Error('Refresh failed')
  return { accessToken: result.AccessToken, idToken: result.IdToken }
}

export async function forgotPassword(email: string): Promise<void> {
  await cognito.send(new ForgotPasswordCommand({ ClientId: CLIENT_ID, Username: email }))
}

export async function confirmResetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await cognito.send(new ConfirmForgotPasswordCommand({
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  }))
}

export function encryptToken(token: string): string {
  const secret = process.env.TOKEN_SECRET ?? 'syntra-secret'
  const key = secret.repeat(Math.ceil(token.length / secret.length)).slice(0, token.length)
  const bytes = Buffer.from(token, 'utf-8')
  const result = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ key.charCodeAt(i)
  }
  return result.toString('base64')
}

export function decryptToken(encrypted: string): string {
  const secret = process.env.TOKEN_SECRET ?? 'syntra-secret'
  const bytes = Buffer.from(encrypted, 'base64')
  const key = secret.repeat(Math.ceil(bytes.length / secret.length)).slice(0, bytes.length)
  const result = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ key.charCodeAt(i)
  }
  return result.toString('utf-8')
}
