import { Components, Theme } from '@mui/material/styles';

/**
 * Component style overrides
 * Returns a function that takes the theme to access palette/shadows
 */
export function getComponents(theme: Theme): Components<Theme> {
  const isDark = theme.palette.mode === 'dark';

  return {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: isDark ? theme.palette.grey[700] : theme.palette.grey[300],
            borderRadius: 4,
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'transparent',
          },
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          transition: 'all 0.2s ease-in-out',
        },
        sizeMedium: {
          padding: '8px 16px',
        },
        sizeSmall: {
          padding: '6px 12px',
        },
        sizeLarge: {
          padding: '12px 24px',
          fontSize: '1rem',
        },
        contained: {
          boxShadow: theme.shadows[2],
          '&:hover': {
            boxShadow: theme.shadows[4],
            transform: 'translateY(-1px)',
          },
          '&:active': {
            boxShadow: theme.shadows[1],
            transform: 'translateY(0)',
          },
        },
        outlined: {
          '&:hover': {
            boxShadow: theme.shadows[1],
          },
        },
      },
      defaultProps: {
        disableElevation: false,
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
          boxShadow: theme.shadows[2],
          border: `1px solid ${theme.palette.divider}`,
          transition: 'box-shadow 0.2s ease-in-out',
          '&:hover': {
            boxShadow: theme.shadows[4],
          },
        },
      },
      defaultProps: {
        elevation: 0,
      },
    },

    MuiCardHeader: {
      styleOverrides: {
        root: {
          padding: 16,
        },
        title: {
          fontWeight: 600,
        },
      },
    },

    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 16,
          '&:last-child': {
            paddingBottom: 16,
          },
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: theme.shadows[1],
          border: `1px solid ${theme.palette.divider}`,
        },
        rounded: {
          borderRadius: 12,
        },
        elevation0: {
          boxShadow: 'none',
          border: 'none',
        },
        elevation1: {
          boxShadow: theme.shadows[1],
        },
        elevation2: {
          boxShadow: theme.shadows[2],
        },
        elevation3: {
          boxShadow: theme.shadows[3],
        },
      },
      defaultProps: {
        elevation: 1,
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: 6,
        },
        sizeSmall: {
          height: 24,
        },
      },
      defaultProps: {
        variant: 'filled',
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

    MuiInputBase: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.palette.grey[400],
          },
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
        },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontFamily: '"Playfair Display", Georgia, serif',
          fontWeight: 600,
          fontSize: '1.25rem',
          padding: '16px 24px',
          color: theme.palette.text.primary,
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

    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: 16,
          gap: 8,
        },
      },
    },

    MuiStack: {
      defaultProps: {
        spacing: 2,
      },
    },

    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-root': {
            fontWeight: 600,
            backgroundColor: isDark ? theme.palette.grey[800] : theme.palette.grey[50],
            color: theme.palette.text.primary,
          },
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.04)'
              : 'rgba(0, 0, 0, 0.02)',
          },
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${theme.palette.divider}`,
        },
        sizeSmall: {
          padding: '8px 12px',
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: theme.palette.grey[800],
          fontSize: '0.75rem',
          fontWeight: 500,
          borderRadius: 6,
          padding: '6px 10px',
        },
        arrow: {
          color: theme.palette.grey[800],
        },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          boxShadow: theme.shadows[3],
        },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.875rem',
          padding: '8px 16px',
        },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
        standardSuccess: {
          backgroundColor: theme.palette.success.light + '20',
          color: theme.palette.success.dark,
        },
        standardError: {
          backgroundColor: theme.palette.error.light + '20',
          color: theme.palette.error.dark,
        },
        standardWarning: {
          backgroundColor: theme.palette.warning.light + '20',
          color: theme.palette.warning.dark,
        },
        standardInfo: {
          backgroundColor: theme.palette.info.light + '20',
          color: theme.palette.info.dark,
        },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          height: 6,
        },
      },
    },

    MuiSkeleton: {
      styleOverrides: {
        rounded: {
          borderRadius: 8,
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: isDark
            ? 'rgba(30, 41, 59, 0.95)'
            : 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${theme.palette.divider}`,
        },
      },
      defaultProps: {
        elevation: 0,
        color: 'transparent',
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: `1px solid ${theme.palette.divider}`,
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginBottom: 4,
          '&.Mui-selected': {
            backgroundColor: theme.palette.primary.main + '14',
            '&:hover': {
              backgroundColor: theme.palette.primary.main + '20',
            },
          },
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        indicator: {
          borderRadius: 2,
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          minHeight: 48,
        },
      },
    },

    MuiAccordion: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '12px !important',
          '&:before': {
            display: 'none',
          },
          '&:not(:last-child)': {
            marginBottom: 8,
          },
          '&.Mui-expanded': {
            margin: 0,
            '&:not(:last-child)': {
              marginBottom: 8,
            },
          },
        },
      },
    },

    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 56,
          padding: '0 20px',
          '&.Mui-expanded': {
            minHeight: 56,
          },
        },
        content: {
          margin: '16px 0',
          '&.Mui-expanded': {
            margin: '16px 0',
          },
        },
      },
    },

    MuiAccordionDetails: {
      styleOverrides: {
        root: {
          padding: '0 20px 20px',
        },
      },
    },

    MuiLink: {
      styleOverrides: {
        root: {
          textDecoration: 'none',
          '&:hover': {
            textDecoration: 'underline',
          },
        },
      },
      defaultProps: {
        underline: 'hover',
      },
    },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: '#fff',
            '& + .MuiSwitch-track': {
              backgroundColor: theme.palette.primary.main,
              opacity: 1,
            },
          },
          '&.Mui-disabled + .MuiSwitch-track': {
            opacity: 0.5,
          },
        },
        thumb: {
          boxShadow: theme.shadows[2],
          backgroundColor: isDark ? '#fff' : theme.palette.grey[100],
          border: isDark ? 'none' : `1px solid ${theme.palette.grey[400]}`,
        },
        track: {
          backgroundColor: isDark ? theme.palette.grey[600] : theme.palette.grey[300],
          opacity: 1,
        },
      },
    },

    MuiFormLabel: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          color: theme.palette.text.primary,
          '&.Mui-focused': {
            color: theme.palette.primary.main,
          },
        },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          '&.Mui-focused': {
            color: theme.palette.primary.main,
          },
        },
        shrink: {
          fontWeight: 600,
        },
      },
    },

    MuiFormControlLabel: {
      styleOverrides: {
        root: {
          marginLeft: 0,
          marginRight: 0,
        },
        label: {
          fontSize: '0.875rem',
        },
      },
    },

    MuiList: {
      styleOverrides: {
        root: {
          padding: 0,
        },
      },
    },

    MuiListItem: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.04)'
              : 'rgba(0, 0, 0, 0.02)',
          },
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: theme.palette.divider,
        },
      },
    },

    MuiBadge: {
      styleOverrides: {
        badge: {
          fontWeight: 600,
          fontSize: '0.7rem',
        },
      },
    },

    MuiAvatar: {
      styleOverrides: {
        root: {
          fontWeight: 600,
        },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: 'background-color 0.15s ease',
        },
      },
    },
  };
}
