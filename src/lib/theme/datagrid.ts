import { Theme } from '@mui/material/styles';
import { SxProps } from '@mui/material';

/**
 * DataGrid styling that can be applied via sx prop
 * Usage: <DataGrid sx={getDataGridStyles(theme)} />
 */
export function getDataGridStyles(theme: Theme): SxProps<Theme> {
  const isDark = theme.palette.mode === 'dark';

  return {
    border: 0,
    borderRadius: 2,
    '& .MuiDataGrid-main': {
      borderRadius: 2,
    },
    '& .MuiDataGrid-columnHeaders': {
      backgroundColor: isDark ? theme.palette.grey[800] : theme.palette.grey[50],
      borderBottom: `1px solid ${theme.palette.divider}`,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
    },
    '& .MuiDataGrid-columnHeaderTitle': {
      fontWeight: 600,
      fontSize: '0.8125rem',
      color: isDark ? theme.palette.grey[300] : theme.palette.grey[700],
    },
    '& .MuiDataGrid-row': {
      '&:hover': {
        backgroundColor: isDark
          ? 'rgba(255, 255, 255, 0.04)'
          : 'rgba(0, 0, 0, 0.02)',
      },
      '&.Mui-selected': {
        backgroundColor: isDark
          ? 'rgba(59, 130, 246, 0.12)'
          : 'rgba(37, 99, 235, 0.08)',
        '&:hover': {
          backgroundColor: isDark
            ? 'rgba(59, 130, 246, 0.16)'
            : 'rgba(37, 99, 235, 0.12)',
        },
      },
    },
    '& .MuiDataGrid-cell': {
      borderBottom: `1px solid ${theme.palette.divider}`,
      fontSize: '0.875rem',
      '&:focus': {
        outline: 'none',
      },
      '&:focus-within': {
        outline: 'none',
      },
    },
    '& .MuiDataGrid-columnHeader:focus': {
      outline: 'none',
    },
    '& .MuiDataGrid-columnHeader:focus-within': {
      outline: 'none',
    },
    '& .MuiDataGrid-footerContainer': {
      backgroundColor: isDark ? theme.palette.grey[800] : theme.palette.grey[50],
      borderTop: `1px solid ${theme.palette.divider}`,
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
    },
    '& .MuiTablePagination-root': {
      color: theme.palette.text.secondary,
    },
    '& .MuiDataGrid-virtualScroller': {
      backgroundColor: isDark ? theme.palette.background.paper : '#fff',
    },
    '& .MuiDataGrid-overlay': {
      backgroundColor: isDark
        ? 'rgba(18, 18, 18, 0.8)'
        : 'rgba(255, 255, 255, 0.8)',
    },
    '& .MuiDataGrid-sortIcon': {
      color: theme.palette.text.secondary,
    },
    '& .MuiDataGrid-menuIconButton': {
      color: theme.palette.text.secondary,
    },
  };
}
