'use client';

import Image from 'next/image';
import { Stack, Typography } from '@mui/material';

interface AuthCardHeaderProps {
  title: string;
  description: string;
}

export function AuthCardHeader({ title, description }: AuthCardHeaderProps) {
  return (
    <Stack spacing={2} alignItems="center" sx={{ mb: 4 }}>
      <Image
        src="/logo.png"
        alt="Time to Just Logo"
        width={48}
        height={48}
        className="logo-rotate"
      />
      <Typography variant="h5">
        Time to Just
      </Typography>
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" align="center">
        {description}
      </Typography>
    </Stack>
  );
}
