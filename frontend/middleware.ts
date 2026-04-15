import { NextRequest, NextResponse } from "next/server";

// Route tiers
const FREE_ROUTES = ["/dashboard", "/journal", "/backtest", "/settings"];
const PRO_ROUTES = ["/signals", "/copilot", "/ml-insights", ...FREE_ROUTES];
const ELITE_ROUTES = ["/forecast", "/paper-trading", ...PRO_ROUTES];
const ADMIN_ROUTES = ["/admin", ...ELITE_ROUTES];
const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password", "/upgrade"];

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split(".")[1];
    if (!base64) return null;
    // Node-compatible base64url decode
    const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getPlanFromGroups(groups: string[]): "free" | "pro" | "elite" | "admin" {
  if (groups.includes("admin")) return "admin";
  if (groups.includes("elite")) return "elite";
  if (groups.includes("pro")) return "pro";
  return "free";
}

function isRouteAllowed(
  pathname: string,
  plan: "free" | "pro" | "elite" | "admin"
): boolean {
  const allowedRoutes =
    plan === "admin"
      ? ADMIN_ROUTES
      : plan === "elite"
      ? ELITE_ROUTES
      : plan === "pro"
      ? PRO_ROUTES
      : FREE_ROUTES;

  return allowedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes and Next.js internals
  if (
    PUBLIC_ROUTES.some(
      (r) => pathname === r || pathname.startsWith(r + "/")
    ) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icons")
  ) {
    return NextResponse.next();
  }

  // Get token from cookie
  const token = request.cookies.get("syntra_token")?.value;

  if (!token) {
    // Not authenticated → redirect to login
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Check token expiry and plan
  const payload = decodeJwtPayload(token);

  if (!payload) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Check expiry
  const exp = payload.exp as number | undefined;
  if (exp && Date.now() / 1000 > exp) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const response = NextResponse.redirect(url);
    response.cookies.delete("syntra_token");
    return response;
  }

  const groups = (payload["cognito:groups"] as string[]) ?? [];
  const plan = getPlanFromGroups(groups);

  // Root redirect
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Check route authorization
  if (!isRouteAllowed(pathname, plan)) {
    const url = request.nextUrl.clone();
    url.pathname = "/upgrade";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/).*)",
  ],
};
