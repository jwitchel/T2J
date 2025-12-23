'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { useAuth } from '@/lib/auth-context';
import { useMuiToast } from '@/hooks/use-mui-toast';

function OAuthCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { success, error: showError } = useMuiToast();
  const [status, setStatus] = useState<'processing' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    async function completeOAuth() {
      if (!user) {
        showError('You must be signed in to connect an email account');
        router.push('/poc/mui-signin');
        return;
      }

      const sessionToken = searchParams.get('session');
      const error = searchParams.get('error');

      if (error) {
        setStatus('error');
        let message = 'OAuth connection failed';
        switch (error) {
          case 'oauth_denied':
            message = 'OAuth authorization was denied';
            break;
          case 'invalid_callback':
            message = 'Invalid OAuth callback parameters';
            break;
          case 'invalid_state':
            message = 'Invalid OAuth state - please try again';
            break;
          case 'oauth_config':
            message = 'OAuth configuration error';
            break;
          case 'token_exchange':
            message = 'Failed to exchange authorization code for tokens';
            break;
          case 'user_info':
            message = 'Failed to retrieve email information';
            break;
          case 'callback_error':
            message = 'An error occurred during OAuth callback';
            break;
        }
        setErrorMessage(message);
        showError(message);
        setTimeout(() => router.push('/poc/mui-email-accounts'), 2000);
        return;
      }

      if (!sessionToken) {
        setStatus('error');
        setErrorMessage('No session token provided');
        showError('No session token provided');
        setTimeout(() => router.push('/poc/mui-email-accounts'), 2000);
        return;
      }

      try {
        // Complete the OAuth flow
        const response = await fetch('/api/oauth-direct/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionToken }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to complete OAuth flow');
        }

        const { email } = await response.json();
        success(`Successfully connected ${email} with OAuth!`);
        router.push('/poc/mui-email-accounts');
      } catch (err) {
        setStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to complete OAuth connection';
        setErrorMessage(message);
        console.error('OAuth completion error:', err);
        showError(message);
        setTimeout(() => router.push('/poc/mui-email-accounts'), 2000);
      }
    }

    completeOAuth();
  }, [user, router, searchParams, success, showError]);

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box sx={{ textAlign: 'center', maxWidth: 400 }}>
        {status === 'processing' ? (
          <>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6">Completing OAuth connection...</Typography>
          </>
        ) : (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>
              {errorMessage}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Redirecting back to email accounts...
            </Typography>
          </>
        )}
      </Box>
    </Box>
  );
}

export default function MuiOAuthCompletePage() {
  return (
    <Suspense
      fallback={
        <Box
          sx={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6">Loading...</Typography>
          </Box>
        </Box>
      }
    >
      <OAuthCompleteContent />
    </Suspense>
  );
}
