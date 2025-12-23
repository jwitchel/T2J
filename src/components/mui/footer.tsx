'use client';

import Link from 'next/link';
import { Box, Container, Stack, Link as MuiLink } from '@mui/material';

const footerLinks = [
  { href: '/poc/mui-about', label: 'About' },
  { href: '/poc/mui-contact', label: 'Contact Us' },
  { href: '/poc/mui-legal', label: 'Legal' },
];

export function MuiFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <Box
      component="footer"
      sx={{
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        py: 4,
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems="center"
          spacing={2}
        >
          <Box component="span" sx={{ typography: 'body2' }}>
            &copy; {currentYear} Time to Just. All rights reserved.
          </Box>

          <Stack direction="row" spacing={3}>
            {footerLinks.map((link) => (
              <MuiLink
                key={link.href}
                component={Link}
                href={link.href}
                variant="body2"
                underline="hover"
              >
                {link.label}
              </MuiLink>
            ))}
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
