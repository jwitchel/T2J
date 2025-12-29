'use client';

import { useTheme } from '@mui/material/styles';
import { actionColors } from '@/lib/theme';
import { EmailActionType } from '../../server/src/types/email-action-tracking';

/**
 * Hook to get theme-aware action colors
 * Returns colors appropriate for the current light/dark mode
 */
export function useActionColors() {
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  return actionColors[mode];
}

/**
 * Hook to get a specific action color
 */
export function useActionColor(actionType: EmailActionType | string): string {
  const colors = useActionColors();
  return colors[actionType as EmailActionType] ?? colors[EmailActionType.PENDING];
}
