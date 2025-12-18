import { createAuthClient } from 'better-auth/react'

// Token storage key for bearer authentication
// This bypasses third-party cookie blocking on mobile browsers (Safari ITP, Chrome)
export const AUTH_TOKEN_KEY = 'better-auth-token'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL!,
  fetchOptions: {
    auth: {
      type: 'Bearer',
      token: () => {
        // Only access localStorage in browser
        if (typeof window !== 'undefined') {
          return localStorage.getItem(AUTH_TOKEN_KEY) || ''
        }
        return ''
      },
    },
  },
})
