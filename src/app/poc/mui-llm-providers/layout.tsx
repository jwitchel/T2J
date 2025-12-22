'use client';

import { Container } from '@mui/material';
import { MuiThemeProvider } from '@/components/mui-theme-provider';
import { MuiSnackbarProvider } from '@/components/mui-snackbar-provider';
import { ConfirmProvider } from 'material-ui-confirm';

interface LayoutProps {
  children: React.ReactNode;
}

export default function MuiPocLayout({ children }: LayoutProps) {
  return (
    <MuiThemeProvider>
      <MuiSnackbarProvider>
        <ConfirmProvider defaultOptions={{ dialogProps: { disableRestoreFocus: true } }}>
          <Container maxWidth="lg" sx={{ py: 3 }}>
            {children}
          </Container>
        </ConfirmProvider>
      </MuiSnackbarProvider>
    </MuiThemeProvider>
  );
}
