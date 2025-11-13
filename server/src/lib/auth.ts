import { betterAuth } from 'better-auth';
import { pool } from './db';
import crypto from 'crypto';

const auth = betterAuth({
  database: pool,
  baseURL: process.env.BACKEND_URL!,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Disable for development
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectURI: `${process.env.BACKEND_URL!}/api/auth/callback/google`,
      scope: ['openid', 'email', 'profile', 'https://mail.google.com/'],
      accessType: 'offline',
      prompt: 'consent',
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
  redirects: {
    afterSignIn: process.env.OAUTH_CALLBACK_URI!,
    afterError: process.env.OAUTH_ERROR_REDIRECT_URI!,
  },
  trustedOrigins: (process.env.TRUSTED_ORIGINS || 'http://localhost:3001,http://localhost:3002').split(','),
});

// Named export
export { auth };

// Default export for CLI
export default auth;