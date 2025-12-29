'use client';

import { SnackbarProvider } from 'notistack';

interface MuiSnackbarProviderProps {
  children: React.ReactNode;
}

export function MuiSnackbarProvider({ children }: MuiSnackbarProviderProps) {
  return (
    <SnackbarProvider
      maxSnack={3}
      autoHideDuration={4000}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      {children}
    </SnackbarProvider>
  );
}
