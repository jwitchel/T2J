'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Typography,
  Stack,
  CircularProgress,
} from '@mui/material';
import { useAuth } from '@/lib/auth-context';
import { MuiPublicLayout } from '@/components/mui';

export default function MuiHomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <MuiPublicLayout>
      <Container maxWidth="lg" sx={{ py: 8 }}>
        {/* Hero Section */}
        <Box sx={{ textAlign: 'center', mb: 8 }}>
          <Typography variant="h2" component="h1" fontWeight="bold" gutterBottom>
            AI-Powered Email Reply Drafts
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 4, maxWidth: 600, mx: 'auto' }}>
            Generate email responses that match your unique writing tone and style
          </Typography>
          <Button
            component={Link}
            href="/signup"
            variant="contained"
            size="large"
            sx={{ px: 4, py: 1.5 }}
          >
            Get Started
          </Button>
        </Box>

        {/* Feature Cards */}
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={3}
          sx={{ maxWidth: 1000, mx: 'auto' }}
        >
          <Card sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight="medium" gutterBottom>
                Tone Analysis
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Our AI analyzes your email history to learn your unique writing style, ensuring
                replies sound authentically like you.
              </Typography>
            </CardContent>
          </Card>

          <Card sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight="medium" gutterBottom>
                Smart Drafts
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Generate contextually appropriate email replies in seconds, maintaining
                professionalism while saving time.
              </Typography>
            </CardContent>
          </Card>

          <Card sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight="medium" gutterBottom>
                Email Integration
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Connect your email accounts securely and manage all your correspondence from one
                unified interface.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
