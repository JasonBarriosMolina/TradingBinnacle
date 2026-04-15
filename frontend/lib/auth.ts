import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

export const cognitoConfig = {
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
};

function getUserPool(): CognitoUserPool {
  return new CognitoUserPool(cognitoConfig);
}

export async function signIn(
  email: string,
  password: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    const user = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    user.authenticateUser(authDetails, {
      onSuccess(session: CognitoUserSession) {
        const token = session.getIdToken().getJwtToken();
        // Store in localStorage for client-side access
        localStorage.setItem("syntra_token", token);
        // Store in cookie for middleware
        document.cookie = `syntra_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
        resolve(token);
      },
      onFailure(err) {
        reject(err);
      },
      newPasswordRequired(_userAttributes, _requiredAttributes) {
        reject(new Error("NEW_PASSWORD_REQUIRED"));
      },
    });
  });
}

export async function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    const attributes = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
    ];

    userPool.signUp(email, password, attributes, [], (err, _result) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export async function confirmSignUp(
  email: string,
  code: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmRegistration(code, true, (err, _result) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function signOut(): Promise<void> {
  const userPool = getUserPool();
  const user = userPool.getCurrentUser();
  if (user) {
    user.signOut();
  }
  localStorage.removeItem("syntra_token");
  document.cookie =
    "syntra_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

export async function getToken(): Promise<string | null> {
  // Try localStorage first
  if (typeof window !== "undefined") {
    const cached = localStorage.getItem("syntra_token");
    if (cached) return cached;
  }

  return new Promise((resolve) => {
    const userPool = getUserPool();
    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }

    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      const token = session.getIdToken().getJwtToken();
      localStorage.setItem("syntra_token", token);
      resolve(token);
    });
  });
}

export interface UserInfo {
  userId: string;
  email: string;
  plan: string;
  groups: string[];
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  const token = await getToken();
  if (!token) return null;

  try {
    // Decode JWT payload (base64)
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    const groups: string[] = payload["cognito:groups"] ?? [];
    let plan = "free";
    if (groups.includes("elite")) plan = "elite";
    else if (groups.includes("pro")) plan = "pro";

    return {
      userId: payload.sub,
      email: payload.email,
      plan,
      groups,
    };
  } catch {
    return null;
  }
}

export async function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.forgotPassword({
      onSuccess() {
        resolve();
      },
      onFailure(err) {
        reject(err);
      },
    });
  });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmPassword(code, newPassword, {
      onSuccess() {
        resolve();
      },
      onFailure(err) {
        reject(err);
      },
    });
  });
}
