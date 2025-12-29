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
import { useTheme } from '@mui/material/styles';
import PsychologyIcon from '@mui/icons-material/Psychology';
import EditNoteIcon from '@mui/icons-material/EditNote';
import EmailIcon from '@mui/icons-material/Email';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import { useAuth } from '@/lib/auth-context';
import { MuiPublicLayout } from '@/components/mui';

export default function MuiHomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

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

  // Theme-aware colors using steel blue palette
  const steelBlue = {
    800: '#0B2648',
    700: '#1e4577',
    600: '#2d5a9a',
    500: '#3b6fb6',
    400: '#5985c1',
  };

  const colors = {
    heroGradient: isDark
      ? `linear-gradient(135deg, #f8fafc 0%, #f8fafc 60%, ${steelBlue[400]} 100%)`
      : `linear-gradient(135deg, ${steelBlue[800]} 0%, ${steelBlue[800]} 60%, ${steelBlue[500]} 100%)`,
    cardBody: isDark ? '#94a3b8' : '#64748b',
    secondaryBtnColor: isDark ? '#cbd5e1' : '#334155',
    secondaryBtnBg: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(71, 85, 105, 0.08)',
    secondaryBtnBorder: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(71, 85, 105, 0.2)',
    secondaryBtnHoverBg: isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(71, 85, 105, 0.14)',
    cardShadow: isDark
      ? '0 4px 20px rgba(0, 0, 0, 0.3)'
      : '0 4px 20px rgba(0, 0, 0, 0.08)',
    cardHoverShadow: isDark
      ? '0 8px 30px rgba(0, 0, 0, 0.4)'
      : '0 8px 30px rgba(0, 0, 0, 0.12)',
    cardBorder: isDark
      ? '1px solid rgba(255, 255, 255, 0.06)'
      : '1px solid rgba(0, 0, 0, 0.04)',
    // Icon backgrounds using steel blue theme
    iconAmberBg: isDark
      ? 'linear-gradient(135deg, #78350f 0%, #92400e 100%)'
      : 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    iconIndigoBg: isDark
      ? 'linear-gradient(135deg, #312e81 0%, #3730a3 100%)'
      : 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
    iconSteelBg: isDark
      ? `linear-gradient(135deg, ${steelBlue[700]} 0%, ${steelBlue[600]} 100%)`
      : `linear-gradient(135deg, #e8eef5 0%, #c5d4e8 100%)`,
    iconAmber: isDark ? '#fbbf24' : '#b45309',
    iconIndigo: isDark ? '#a5b4fc' : '#4f46e5',
    iconSteel: isDark ? steelBlue[400] : steelBlue[800],
    // CTA button gradients
    ctaGradient: isDark
      ? `linear-gradient(135deg, ${steelBlue[500]} 0%, #6366f1 100%)`
      : `linear-gradient(135deg, ${steelBlue[800]} 0%, ${steelBlue[600]} 100%)`,
    ctaHoverGradient: isDark
      ? `linear-gradient(135deg, ${steelBlue[400]} 0%, #818cf8 100%)`
      : `linear-gradient(135deg, ${steelBlue[700]} 0%, ${steelBlue[500]} 100%)`,
    ctaShadow: isDark
      ? `0 4px 14px rgba(89, 133, 193, 0.35)`
      : `0 4px 14px rgba(11, 38, 72, 0.35)`,
    ctaHoverShadow: isDark
      ? `0 6px 20px rgba(89, 133, 193, 0.45)`
      : `0 6px 20px rgba(11, 38, 72, 0.45)`,
  };

  // Shared card styles - elevated by default
  const cardStyles = {
    flex: 1,
    boxShadow: colors.cardShadow,
    border: colors.cardBorder,
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: colors.cardHoverShadow,
    },
  };

  return (
    <MuiPublicLayout>
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 12 } }}>
        {/* Hero Section */}
        <Box sx={{ textAlign: 'center', mb: { xs: 8, md: 12 } }}>
          <Typography
            variant="h2"
            component="h1"
            sx={{
              fontSize: { xs: '2.5rem', md: '3.75rem' },
              fontWeight: 600,
              mb: 3,
              lineHeight: 1.1,
              background: colors.heroGradient,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Email replies that sound like you
          </Typography>
          <Typography
            variant="body1"
            sx={{
              mb: 5,
              maxWidth: 520,
              mx: 'auto',
              color: 'text.secondary',
              fontSize: '1.125rem',
              fontWeight: 400,
              lineHeight: 1.7,
            }}
          >
            AI learns your writing style and drafts personalized responses—so you spend less time typing and more time doing.
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            justifyContent="center"
            alignItems="center"
          >
            <Button
              component={Link}
              href="/signup"
              variant="contained"
              size="large"
              endIcon={<ArrowForwardIcon />}
              sx={{
                px: 4,
                py: 1.5,
                fontSize: '1rem',
                background: colors.ctaGradient,
                boxShadow: colors.ctaShadow,
                '&:hover': {
                  background: colors.ctaHoverGradient,
                  boxShadow: colors.ctaHoverShadow,
                },
              }}
            >
              Get Started Free
            </Button>
            <Button
              component={Link}
              href="/demo"
              size="large"
              startIcon={<PlayCircleOutlineIcon />}
              sx={{
                px: 3.5,
                py: 1.5,
                fontSize: '1rem',
                color: colors.secondaryBtnColor,
                backgroundColor: colors.secondaryBtnBg,
                border: `1px solid ${colors.secondaryBtnBorder}`,
                '&:hover': {
                  backgroundColor: colors.secondaryBtnHoverBg,
                  borderColor: colors.secondaryBtnBorder,
                },
              }}
            >
              Watch Demo
            </Button>
          </Stack>
        </Box>

        {/* Feature Cards */}
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={3}
          sx={{ maxWidth: 1000, mx: 'auto' }}
        >
          <Card sx={cardStyles}>
            <CardContent sx={{ p: 4 }}>
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  borderRadius: 2.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2.5,
                  background: colors.iconAmberBg,
                  boxShadow: '0 2px 8px rgba(217, 119, 6, 0.15)',
                }}
              >
                <PsychologyIcon sx={{ color: colors.iconAmber, fontSize: 28 }} />
              </Box>
              <Typography variant="sectionHeader" sx={{ mb: 1 }}>
                Learns Your Tone
              </Typography>
              <Typography sx={{ color: colors.cardBody, lineHeight: 1.7, fontSize: '0.925rem' }}>
                Our AI analyzes your past emails to understand how you communicate—vocabulary, style, even your sign-offs.
              </Typography>
            </CardContent>
          </Card>

          <Card sx={cardStyles}>
            <CardContent sx={{ p: 4 }}>
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  borderRadius: 2.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2.5,
                  background: colors.iconIndigoBg,
                  boxShadow: '0 2px 8px rgba(99, 102, 241, 0.15)',
                }}
              >
                <EditNoteIcon sx={{ color: colors.iconIndigo, fontSize: 28 }} />
              </Box>
              <Typography variant="sectionHeader" sx={{ mb: 1 }}>
                Instant Drafts
              </Typography>
              <Typography sx={{ color: colors.cardBody, lineHeight: 1.7, fontSize: '0.925rem' }}>
                Get contextually-aware reply drafts in seconds. Review, tweak if needed, and send—your inbox clears faster.
              </Typography>
            </CardContent>
          </Card>

          <Card sx={cardStyles}>
            <CardContent sx={{ p: 4 }}>
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  borderRadius: 2.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2.5,
                  background: colors.iconSteelBg,
                  boxShadow: '0 2px 8px rgba(11, 38, 72, 0.15)',
                }}
              >
                <EmailIcon sx={{ color: colors.iconSteel, fontSize: 28 }} />
              </Box>
              <Typography variant="sectionHeader" sx={{ mb: 1 }}>
                Secure Integration
              </Typography>
              <Typography sx={{ color: colors.cardBody, lineHeight: 1.7, fontSize: '0.925rem' }}>
                Connect Gmail, Outlook, or any IMAP account. Your data stays encrypted and private—we never share it.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
