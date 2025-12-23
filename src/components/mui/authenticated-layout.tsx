'use client';

import { Box, Container } from '@mui/material';
import { MuiNavbar } from './navbar';
import { MuiFooter } from './footer';

interface MuiAuthenticatedLayoutProps {
  children: React.ReactNode;
  user: {
    name?: string;
    email: string;
  };
  onSignOut: () => Promise<void>;
}

/**
 * Layout wrapper for authenticated pages.
 * This is purely a visual layout - auth protection should be handled
 * by the page itself using useAuth() and marking the page as dynamic.
 */
export function MuiAuthenticatedLayout({ children, user, onSignOut }: MuiAuthenticatedLayoutProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <MuiNavbar variant="authenticated" user={user} onSignOut={onSignOut} />
      <Box component="main" sx={{ flex: 1 }}>
        <Container maxWidth="lg" sx={{ py: 3 }}>
          {children}
        </Container>
      </Box>
      <MuiFooter />
    </Box>
  );
}
