'use client';

import NextLink from 'next/link';
import { Link as MuiLink, LinkProps } from '@mui/material';

interface StyledLinkProps extends Omit<LinkProps, 'href'> {
  href: string;
  children: React.ReactNode;
}

export function StyledLink({ href, children, ...props }: StyledLinkProps) {
  return (
    <MuiLink
      component={NextLink}
      href={href}
      color="primary"
      underline="hover"
      {...props}
    >
      {children}
    </MuiLink>
  );
}
