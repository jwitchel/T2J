import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { pool } from './db';
import { sharedConnection } from './redis-connection';
import crypto from 'crypto';
import { preferencesService } from './preferences-service';

const auth = betterAuth({
  plugins: [bearer()],
  database: pool,
  baseURL: process.env.BACKEND_URL!,
  secondaryStorage: {
    get: async (key) => {
      return sharedConnection.get(key);
    },
    set: async (key, value, ttl) => {
      if (ttl) {
        await sharedConnection.set(key, value, 'EX', ttl);
      } else {
        await sharedConnection.set(key, value);
      }
    },
    delete: async (key) => {
      await sharedConnection.del(key);
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Disable for development
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectURI: `${process.env.BACKEND_URL!}/api/auth/callback/google`,
      scope: ['openid', 'email', 'profile', 'https://mail.google.com/'],
      accessType: 'offline',
      prompt: 'consent',
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60, // 1 minute (Redis makes cache misses cheap)
    },
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
    crossSubDomainCookies: {
      enabled: process.env.NODE_ENV === 'production',
    },
    defaultCookieAttributes: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: true,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Initialize default preferences for new users
          return {
            data: {
              ...user,
              preferences: preferencesService.getDefaultPreferences(),
            },
          };
        },
      },
    },
  },
  redirects: {
    afterSignIn: process.env.OAUTH_CALLBACK_URI!,
    afterError: process.env.OAUTH_ERROR_REDIRECT_URI!,
  },
  trustedOrigins: process.env.TRUSTED_ORIGINS!.split(','),
});

// Named export
export { auth };

// Default export for CLI
export default auth;