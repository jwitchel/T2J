'use client';

import { useTheme } from '@mui/material/styles';
import { chartColors } from '@/lib/theme';

interface EChartsTheme {
  backgroundColor: string;
  textStyle: {
    color: string;
    fontFamily: string;
  };
  color: readonly string[];
  axisLine: {
    lineStyle: {
      color: string;
    };
  };
  splitLine: {
    lineStyle: {
      color: string;
    };
  };
  legend: {
    textStyle: {
      color: string;
    };
  };
  tooltip: {
    backgroundColor: string;
    borderColor: string;
    textStyle: {
      color: string;
    };
  };
}

/**
 * Hook to get eCharts theme configuration based on MUI theme
 * Provides consistent colors and styling for charts
 */
export function useEChartsTheme(): EChartsTheme {
  const muiTheme = useTheme();
  const isDark = muiTheme.palette.mode === 'dark';

  return {
    backgroundColor: 'transparent',
    textStyle: {
      color: muiTheme.palette.text.primary,
      fontFamily: muiTheme.typography.fontFamily as string,
    },
    color: isDark ? chartColors.dark : chartColors.light,
    axisLine: {
      lineStyle: {
        color: muiTheme.palette.divider,
      },
    },
    splitLine: {
      lineStyle: {
        color: muiTheme.palette.divider,
      },
    },
    legend: {
      textStyle: {
        color: muiTheme.palette.text.secondary,
      },
    },
    tooltip: {
      backgroundColor: muiTheme.palette.background.paper,
      borderColor: muiTheme.palette.divider,
      textStyle: {
        color: muiTheme.palette.text.primary,
      },
    },
  };
}

/**
 * Get chart colors for the current theme mode
 */
export function useChartColors(): readonly string[] {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode === 'dark' ? 'dark' : 'light';
  return chartColors[mode];
}
