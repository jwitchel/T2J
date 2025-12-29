'use client';

import { Box, Typography } from '@mui/material';

interface PageHeaderProps {
  title: string;
  description?: string;
  centered?: boolean;
}

export function PageHeader({ title, description, centered = false }: PageHeaderProps) {
  return (
    <Box sx={{ textAlign: centered ? 'center' : 'left', mb: 5 }}>
      <Typography variant="h4">
        {title}
      </Typography>
      {description && (
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{
            mt: 1.5,
            maxWidth: centered ? 600 : undefined,
            mx: centered ? 'auto' : undefined,
          }}
        >
          {description}
        </Typography>
      )}
    </Box>
  );
}
