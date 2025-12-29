import { EmailActionType } from '../../../server/src/types/email-action-tracking';

/**
 * Theme-aware action colors
 * Uses steel blue family for primary actions, emerald for success, orange for error
 */
export const actionColors = {
  light: {
    [EmailActionType.PENDING]: '#94a3b8',           // slate-400
    [EmailActionType.REPLY]: '#1e4577',             // steel blue-700 (primary)
    [EmailActionType.REPLY_ALL]: '#4f46e5',         // indigo-600
    [EmailActionType.FORWARD]: '#6366f1',           // indigo-500 (secondary)
    [EmailActionType.FORWARD_WITH_COMMENT]: '#7c3aed', // violet-600
    [EmailActionType.SILENT_FYI_ONLY]: '#64748b',   // slate-500
    [EmailActionType.SILENT_SPAM]: '#c2410c',       // orange-700 (error)
    [EmailActionType.SILENT_LARGE_LIST]: '#64748b', // slate-500
    [EmailActionType.SILENT_UNSUBSCRIBE]: '#64748b', // slate-500
    [EmailActionType.SILENT_TODO]: '#d97706',       // amber-600 (warning)
    [EmailActionType.KEEP_IN_INBOX]: '#ca8a04',     // yellow-600
    [EmailActionType.TRAINING]: '#3b6fb6',          // steel blue-500 (info)
    [EmailActionType.MANUALLY_HANDLED]: '#059669',  // emerald-600 (success)
  },
  dark: {
    [EmailActionType.PENDING]: '#64748b',           // slate-500
    [EmailActionType.REPLY]: '#5985c1',             // steel blue-400
    [EmailActionType.REPLY_ALL]: '#6366f1',         // indigo-500
    [EmailActionType.FORWARD]: '#818cf8',           // indigo-400
    [EmailActionType.FORWARD_WITH_COMMENT]: '#a78bfa', // violet-400
    [EmailActionType.SILENT_FYI_ONLY]: '#475569',   // slate-600
    [EmailActionType.SILENT_SPAM]: '#ea580c',       // orange-600 (error)
    [EmailActionType.SILENT_LARGE_LIST]: '#475569', // slate-600
    [EmailActionType.SILENT_UNSUBSCRIBE]: '#475569', // slate-600
    [EmailActionType.SILENT_TODO]: '#f59e0b',       // amber-500 (warning)
    [EmailActionType.KEEP_IN_INBOX]: '#eab308',     // yellow-500
    [EmailActionType.TRAINING]: '#779bcc',          // steel blue-300 (info)
    [EmailActionType.MANUALLY_HANDLED]: '#10b981',  // emerald-500 (success)
  },
} as const;

/**
 * Relationship colors for email contacts
 * Uses steel blue harmonious palette
 */
export const relationshipColors = {
  light: {
    spouse: '#db2777',      // pink-600
    family: '#7c3aed',      // violet-600
    colleague: '#1e4577',   // steel blue-700
    friends: '#059669',     // emerald-600 (success)
    external: '#64748b',    // slate-500
    spam: '#c2410c',        // orange-700 (error)
    unknown: '#64748b',     // slate-500
  },
  dark: {
    spouse: '#ec4899',      // pink-500
    family: '#a78bfa',      // violet-400
    colleague: '#5985c1',   // steel blue-400
    friends: '#10b981',     // emerald-500
    external: '#94a3b8',    // slate-400
    spam: '#ea580c',        // orange-600 (error)
    unknown: '#94a3b8',     // slate-400
  },
} as const;

/**
 * Chart color palette for eCharts
 * Ordered for visual distinction in stacked charts
 * Uses steel blue family colors for harmony
 */
export const chartColors = {
  light: [
    '#1e4577',  // steel blue 700 (primary - drafted/reply)
    '#c2410c',  // orange-700 (error - spam, softer than red)
    '#059669',  // emerald-600 (success - moved)
    '#64748b',  // slate-500 (neutral - no action)
    '#d97706',  // amber-600 (warning)
    '#3b6fb6',  // steel blue 500 (info)
    '#6366f1',  // indigo-500 (secondary)
  ],
  dark: [
    '#5985c1',  // steel blue 400 (primary - drafted/reply)
    '#ea580c',  // orange-600 (error - spam)
    '#10b981',  // emerald-500 (success - moved)
    '#94a3b8',  // slate-400 (neutral - no action)
    '#f59e0b',  // amber-500 (warning)
    '#779bcc',  // steel blue 300 (info)
    '#818cf8',  // indigo-400 (secondary)
  ],
} as const;

/**
 * Color palette for email accounts (for visual distinction)
 *
 * Note: These are intentionally NOT theme-aware. Email account colors
 * should remain consistent across light/dark modes so users can quickly
 * identify their accounts by color. The rainbow palette provides maximum
 * visual distinction between accounts.
 */
export const emailAccountColors = [
  '#ef4444',  // red
  '#f97316',  // orange
  '#eab308',  // yellow
  '#22c55e',  // green
  '#14b8a6',  // teal
  '#3b82f6',  // blue
  '#6366f1',  // indigo
  '#a855f7',  // purple
  '#ec4899',  // pink
] as const;
