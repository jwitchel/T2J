import { useEffect } from 'react';

export function usePageTitle(title: string) {
  const fullTitle = title ? `${title} | Time to Just` : 'Time to Just';

  // Set immediately on render (works during SSR check)
  if (typeof document !== 'undefined') {
    document.title = fullTitle;
  }

  // Also set in useEffect for navigation
  useEffect(() => {
    document.title = fullTitle;
  }, [fullTitle]);
}
