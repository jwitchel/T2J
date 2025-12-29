import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

/**
 * Protected layout that validates sessions for all child pages.
 * This is the single point of authentication for all protected POC pages.
 *
 * Security model:
 * - Layer 1: Middleware checks cookie existence (fast, optimistic)
 * - Layer 2: This layout validates session via API (secure, database-backed)
 * - Layer 3: API routes use requireAuth middleware (data protection)
 */
export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const cookieStore = await cookies();

  // In production, better-auth prefixes cookies with __Secure- when secure: true
  const secureCookie = cookieStore.get('__Secure-better-auth.session_token');
  const devCookie = cookieStore.get('better-auth.session_token');
  const sessionCookie = secureCookie || devCookie;
  const cookieName = secureCookie ? '__Secure-better-auth.session_token' : 'better-auth.session_token';

  if (!sessionCookie?.value) {
    redirect('/signin');
  }

  // Validate session server-side by calling the Express API
  const baseUrl = process.env.APP_URL || 'http://localhost:3001';
  const response = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: {
      Cookie: `${cookieName}=${sessionCookie.value}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    redirect('/signin');
  }

  const session = await response.json();
  if (!session?.user) {
    redirect('/signin');
  }

  // Session is valid - render children
  // Children use useAuth() hook to access user data client-side
  return children;
}
