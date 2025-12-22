import { createTheme, responsiveFontSizes } from '@mui/material/styles';

// Single theme with automatic dark mode via CSS color-scheme
export const theme = responsiveFontSizes(
  createTheme({
    cssVariables: { colorSchemeSelector: 'class' },
    colorSchemes: { dark: true },
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
