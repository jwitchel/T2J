import { TypographyVariantsOptions } from '@mui/material/styles';

// Extend Typography variants to include custom 'sectionHeader'
declare module '@mui/material/styles' {
  interface TypographyVariants {
    sectionHeader: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    sectionHeader?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    sectionHeader: true;
  }
}

/**
 * Typography configuration
 * - Playfair Display for h1/h2/sectionHeader (elegant, editorial feel)
 * - Inter for everything else (clean, readable)
 * - Warmer text colors for a more inviting feel
 */
export const typography: TypographyVariantsOptions = {
  fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',

  // Hero headings - Playfair Display for elegance
  // Colors inherit from theme text.primary for dark mode support
  h1: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  h2: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  // Page/section headings - Playfair Display for hierarchy
  h3: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },
  h4: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 600,
    fontSize: '2.25rem',
    letterSpacing: '0.02em',
    lineHeight: 1.3,
  },
  h5: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 600,
    lineHeight: 1.5,
  },
  h6: {
    fontWeight: 600,
    lineHeight: 1.5,
  },

  // Section headers - Playfair Display for dashboard/page sections
  // Uses h6 size with serif font for visual hierarchy
  sectionHeader: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 600,
    fontSize: '1.25rem',
    lineHeight: 1.5,
  },

  // Subtitles - medium weight for emphasis, muted color
  subtitle1: {
    fontWeight: 500,
    lineHeight: 1.5,
  },
  subtitle2: {
    fontWeight: 500,
    fontSize: '0.875rem',
    lineHeight: 1.57,
  },

  // Body text - comfortable reading, left aligned
  body1: {
    lineHeight: 1.7,
    textAlign: 'left',
  },
  body2: {
    fontSize: '0.875rem',
    lineHeight: 1.6,
    textAlign: 'left',
  },

  // UI elements
  button: {
    fontWeight: 600,
    textTransform: 'none',
  },
  caption: {
    fontSize: '0.75rem',
    lineHeight: 1.5,
  },
  overline: {
    fontWeight: 600,
    fontSize: '0.75rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    lineHeight: 1.5,
  },
};
