'use client';

import { useMemo } from 'react';
import { ThemeProvider, createTheme, responsiveFontSizes } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useTheme } from 'next-themes';

interface MuiThemeProviderProps {
  children: React.ReactNode;
}

// Base theme configuration shared between light and dark modes
const getTheme = (mode: 'light' | 'dark') =>
  responsiveFontSizes(
    createTheme({
      palette: {
        mode,
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: { textTransform: 'none' },
          },
        },
        MuiPaper: {
          defaultProps: {
            variant: 'outlined',
          },
        },
        MuiStack: {
          defaultProps: {
            spacing: 2,
          },
        },
        MuiDialogActions: {
          styleOverrides: {
            root: {
              padding: 16,
              gap: 8,
              flexWrap: 'wrap',
            },
          },
        },
        MuiDialogContent: {
          styleOverrides: {
            root: {
              paddingTop: 8,
            },
          },
        },
        MuiTextField: {
          defaultProps: {
            size: 'small',
            fullWidth: true,
          },
        },
        MuiFormControl: {
          defaultProps: {
            size: 'small',
            fullWidth: true,
          },
        },
      },
    })
  );

export function MuiThemeProvider({ children }: MuiThemeProviderProps) {
  const { resolvedTheme } = useTheme();

  // Create theme based on next-themes resolved theme
  const theme = useMemo(
    () => getTheme(resolvedTheme === 'dark' ? 'dark' : 'light'),
    [resolvedTheme]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
