import { PaletteOptions } from '@mui/material/styles';

/**
 * Steel Blue palette based on #0B2648
 * A sophisticated, professional color scheme
 */
const steelBlue = {
  50: '#e8eef5',
  100: '#c5d4e8',
  200: '#9eb8da',
  300: '#779bcc',
  400: '#5985c1',
  500: '#3b6fb6',
  600: '#2d5a9a',
  700: '#1e4577',
  800: '#0B2648',   // User's specified color
  900: '#061830',
};

/**
 * Grey scale used across light and dark modes
 * Slate-based for harmony with steel blue
 */
const grey = {
  50: '#f8fafc',   // slate-50
  100: '#f1f5f9',  // slate-100
  200: '#e2e8f0',  // slate-200
  300: '#cbd5e1',  // slate-300
  400: '#94a3b8',  // slate-400
  500: '#64748b',  // slate-500
  600: '#475569',  // slate-600
  700: '#334155',  // slate-700
  800: '#1e293b',  // slate-800
  900: '#0f172a',  // slate-900
};

/**
 * Light mode palette
 * Uses steel blue as primary with sophisticated supporting colors
 */
export const lightPalette: PaletteOptions = {
  mode: 'light',
  primary: {
    main: steelBlue[700],     // #1e4577 - lighter, more visible blue
    light: steelBlue[500],    // #3b6fb6
    dark: steelBlue[800],     // #0B2648
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#6366f1',          // Indigo-500 (complements steel blue)
    light: '#818cf8',         // Indigo-400
    dark: '#4f46e5',          // Indigo-600
    contrastText: '#ffffff',
  },
  error: {
    main: '#c2410c',          // Softer coral-red (orange-700)
    light: '#ea580c',         // orange-600
    dark: '#9a3412',          // orange-800
    contrastText: '#ffffff',
  },
  warning: {
    main: '#d97706',          // Amber-600
    light: '#f59e0b',         // Amber-500
    dark: '#b45309',          // Amber-700
    contrastText: '#ffffff',
  },
  info: {
    main: steelBlue[500],     // Steel blue for info
    light: steelBlue[400],
    dark: steelBlue[600],
    contrastText: '#ffffff',
  },
  success: {
    main: '#059669',          // Emerald-600 (green with slight blue undertone)
    light: '#10b981',         // Emerald-500
    dark: '#047857',          // Emerald-700
    contrastText: '#ffffff',
  },
  grey,
  text: {
    primary: grey[900],
    secondary: grey[600],
    disabled: grey[400],
  },
  divider: grey[200],
  background: {
    default: steelBlue[50],   // #e8eef5 - subtle steel blue tint
    paper: '#ffffff',
  },
  action: {
    active: grey[600],
    hover: 'rgba(11, 38, 72, 0.04)',  // steel blue tint
    selected: 'rgba(11, 38, 72, 0.08)',
    disabled: grey[300],
    disabledBackground: grey[100],
  },
};

/**
 * Dark mode palette
 * Uses lighter steel blue variants for visibility on dark backgrounds
 */
export const darkPalette: PaletteOptions = {
  mode: 'dark',
  primary: {
    main: steelBlue[400],     // #5985c1 - lighter for dark bg
    light: steelBlue[300],    // #779bcc
    dark: steelBlue[500],     // #3b6fb6
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#818cf8',          // Indigo-400
    light: '#a5b4fc',         // Indigo-300
    dark: '#6366f1',          // Indigo-500
    contrastText: '#000000',
  },
  error: {
    main: '#ea580c',          // Softer coral-orange (orange-600)
    light: '#f97316',         // orange-500
    dark: '#c2410c',          // orange-700
    contrastText: '#ffffff',
  },
  warning: {
    main: '#f59e0b',          // Amber-500
    light: '#fbbf24',         // Amber-400
    dark: '#d97706',          // Amber-600
    contrastText: '#000000',
  },
  info: {
    main: steelBlue[400],     // Lighter steel blue
    light: steelBlue[300],
    dark: steelBlue[500],
    contrastText: '#ffffff',
  },
  success: {
    main: '#10b981',          // Emerald-500 (green with slight blue undertone)
    light: '#34d399',         // Emerald-400
    dark: '#059669',          // Emerald-600
    contrastText: '#000000',
  },
  grey,
  text: {
    primary: '#f8fafc',
    secondary: grey[400],
    disabled: grey[600],
  },
  divider: grey[700],
  background: {
    default: '#0f172a',       // slate-900 (deep, sophisticated)
    paper: grey[800],         // slate-800
  },
  action: {
    active: grey[400],
    hover: 'rgba(89, 133, 193, 0.12)',  // steel blue tint
    selected: 'rgba(89, 133, 193, 0.20)',
    disabled: grey[600],
    disabledBackground: grey[800],
  },
};
