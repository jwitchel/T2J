import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const protectedRoutes = [
  '/poc/mui-dashboard',
  '/poc/mui-settings',
  '/poc/mui-email-accounts',
  '/poc/mui-llm-providers',
  '/poc/mui-jobs',
  '/poc/mui-tone',
  '/poc/mui-inbox',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for better-auth session cookie
  const sessionCookie = request.cookies.get('better-auth.session_token');
  const isAuthenticated = Boolean(sessionCookie?.value);

  // Protect authenticated routes
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));
  if (isProtectedRoute && !isAuthenticated) {
    const signinUrl = new URL('/poc/mui-signin', request.url);
    signinUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signinUrl);
  }

  // Note: We intentionally do NOT redirect authenticated users away from auth pages.
  // Middleware only checks cookie existence, not validity. If an expired/invalid
  // session cookie exists, the protected layout will properly validate and redirect
  // to signin. If we redirected here, it would create an infinite loop.
  // Auth pages handle "already logged in" client-side via useAuth() hook.

  return NextResponse.next();
}

export const config = {
  matcher: ['/poc/:path*'],
};
