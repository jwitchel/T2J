'use client';

import { Box } from '@mui/material';
import { MuiNavbar } from './navbar';
import { MuiFooter } from './footer';

interface MuiPublicLayoutProps {
  children: React.ReactNode;
}

export function MuiPublicLayout({ children }: MuiPublicLayoutProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <MuiNavbar variant="public" />
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>
      <MuiFooter />
    </Box>
  );
}
