'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import { authClient, AUTH_TOKEN_KEY } from './auth-client'

interface User {
  id: string
  email: string
  emailVerified?: boolean
  name?: string
  createdAt?: Date | string
  updatedAt?: Date | string
  image?: string | null
}

interface AuthContextType {
  user: User | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name?: string) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const [error, setError] = useState<string | null>(null)

  async function signIn(email: string, password: string) {
    try {
      setError(null)
      const { error } = await authClient.signIn.email(
        {
          email,
          password,
        },
        {
          onSuccess: (ctx) => {
            // Store bearer token for mobile browsers that block third-party cookies
            const authToken = ctx.response.headers.get('set-auth-token')
            if (authToken) {
              localStorage.setItem(AUTH_TOKEN_KEY, authToken)
            }
          },
        }
      )

      if (error) {
        throw new Error(error.message || 'Sign in failed')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      setError(message)
      throw err
    }
  }

  async function signUp(email: string, password: string, name?: string) {
    try {
      setError(null)
      const { error } = await authClient.signUp.email(
        {
          email,
          password,
          name: name || '',
        },
        {
          onSuccess: (ctx) => {
            // Store bearer token for mobile browsers that block third-party cookies
            const authToken = ctx.response.headers.get('set-auth-token')
            if (authToken) {
              localStorage.setItem(AUTH_TOKEN_KEY, authToken)
            }
          },
        }
      )

      if (error) {
        throw new Error(error.message || 'Sign up failed')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      setError(message)
      throw err
    }
  }

  async function signOut() {
    try {
      setError(null)
      // Clear bearer token from localStorage
      localStorage.removeItem(AUTH_TOKEN_KEY)
      const { error } = await authClient.signOut()

      if (error) {
        throw new Error(error.message || 'Sign out failed')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed'
      setError(message)
      throw err
    }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    if (currentPassword === newPassword) {
      const message = 'New password must be different from current password'
      setError(message)
      throw new Error(message)
    }

    try {
      setError(null)
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      })

      if (error) {
        throw new Error(error.message || 'Failed to change password')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password'
      setError(message)
      throw err
    }
  }

  function clearError() {
    setError(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user: session?.user || null,
        loading: isPending,
        error,
        signIn,
        signUp,
        signOut,
        changePassword,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
