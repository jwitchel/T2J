'use client';

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
          {children}
        </ConfirmProvider>
      </MuiSnackbarProvider>
    </MuiThemeProvider>
  );
}
