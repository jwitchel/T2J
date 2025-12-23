'use client';

import { ThemeProvider } from '@/components/theme-provider';
import { MuiThemeProvider } from '@/components/mui-theme-provider';
import { MuiSnackbarProvider } from '@/components/mui-snackbar-provider';
import { ConfirmProvider } from 'material-ui-confirm';
import { AuthProvider } from '@/lib/auth-context';
import { AlertProvider } from '@/lib/alert-context';
import { SWRProvider } from '@/components/swr-provider';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MuiThemeProvider>
        <MuiSnackbarProvider>
          <ConfirmProvider defaultOptions={{ dialogProps: { disableRestoreFocus: true } }}>
            <AuthProvider>
              <SWRProvider>
                <AlertProvider>
                  {children}
                </AlertProvider>
              </SWRProvider>
            </AuthProvider>
          </ConfirmProvider>
        </MuiSnackbarProvider>
      </MuiThemeProvider>
    </ThemeProvider>
  );
}
