import { createTheme, responsiveFontSizes, Theme } from '@mui/material/styles';
import { lightPalette, darkPalette } from './palette';
import { lightShadows, darkShadows } from './shadows';
import { typography } from './typography';
import { getComponents } from './components';

/**
 * Create a theme for the specified mode
 */
function createAppTheme(mode: 'light' | 'dark'): Theme {
  const palette = mode === 'light' ? lightPalette : darkPalette;
  const shadows = mode === 'light' ? lightShadows : darkShadows;

  // First create theme with basic settings
  const baseTheme = createTheme({
    palette,
    shadows,
    typography,
    shape: {
      borderRadius: 8,
    },
  });

  // Then add component overrides that depend on the theme
  const themeWithComponents = createTheme(baseTheme, {
    components: getComponents(baseTheme),
  });

  // Finally apply responsive font sizes
  return responsiveFontSizes(themeWithComponents);
}

/**
 * Pre-built light theme
 */
export const lightTheme = createAppTheme('light');

/**
 * Pre-built dark theme
 */
export const darkTheme = createAppTheme('dark');

/**
 * Get theme by mode
 */
export function getTheme(mode: 'light' | 'dark'): Theme {
  return mode === 'light' ? lightTheme : darkTheme;
}

// Re-export color utilities
export { actionColors, relationshipColors, chartColors, emailAccountColors } from './colors';

// Re-export DataGrid styling
export { getDataGridStyles } from './datagrid';
