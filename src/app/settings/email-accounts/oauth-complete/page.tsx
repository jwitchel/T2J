'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

function OAuthCompleteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [status, setStatus] = useState<'processing' | 'error'>('processing')

  useEffect(() => {
    async function completeOAuth() {
      if (!user) {
        showError('You must be signed in to connect an email account')
        router.push('/signin')
        return
      }

      const sessionToken = searchParams.get('session')
      const error = searchParams.get('error')

      if (error) {
        setStatus('error')
        switch (error) {
          case 'oauth_denied':
            showError('OAuth authorization was denied')
            break
          case 'invalid_callback':
            showError('Invalid OAuth callback parameters')
            break
          case 'invalid_state':
            showError('Invalid OAuth state - please try again')
            break
          case 'oauth_config':
            showError('OAuth configuration error')
            break
          case 'token_exchange':
            showError('Failed to exchange authorization code for tokens')
            break
          case 'user_info':
            showError('Failed to retrieve email information')
            break
          case 'callback_error':
            showError('An error occurred during OAuth callback')
            break
          default:
            showError('OAuth connection failed')
        }
        setTimeout(() => router.push('/settings/email-accounts'), 2000)
        return
      }

      if (!sessionToken) {
        setStatus('error')
        showError('No session token provided')
        setTimeout(() => router.push('/settings/email-accounts'), 2000)
        return
      }

      try {
        // Complete the OAuth flow
        const response = await fetch('/api/oauth-direct/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionToken }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to complete OAuth flow')
        }

        const { email } = await response.json()
        success(`Successfully connected ${email} with OAuth!`)
        router.push('/settings/email-accounts')
      } catch (error) {
        setStatus('error')
        console.error('OAuth completion error:', error)
        showError(error instanceof Error ? error.message : 'Failed to complete OAuth connection')
        setTimeout(() => router.push('/settings/email-accounts'), 2000)
      }
    }

    completeOAuth()
  }, [user, router, searchParams, success, showError])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        {status === 'processing' ? (
          <>
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
            <p className="text-lg">Completing OAuth connection...</p>
          </>
        ) : (
          <>
            <p className="text-lg text-red-600">OAuth connection failed</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Redirecting back to email accounts...
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function OAuthCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
            <p className="text-lg">Loading...</p>
          </div>
        </div>
      }
    >
      <OAuthCompleteContent />
    </Suspense>
  )
}
