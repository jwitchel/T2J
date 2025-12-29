'use client';

import Link from 'next/link';
import { Box, Container, Typography, Card, CardContent, Stack, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PsychologyIcon from '@mui/icons-material/Psychology';
import BoltIcon from '@mui/icons-material/Bolt';
import EmailIcon from '@mui/icons-material/Email';
import SecurityIcon from '@mui/icons-material/Security';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { MuiPublicLayout, PageHeader } from '@/components/mui';
import { usePageTitle } from '@/hooks/use-page-title';

interface FeatureCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
}

function FeatureCard({ icon, iconBg, title, description }: FeatureCardProps) {
  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 2,
            background: iconBg,
          }}
        >
          {icon}
        </Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function MuiAboutPage() {
  usePageTitle('About');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // Theme-aware icon colors
  const iconStyles = {
    psychology: {
      bg: isDark
        ? 'linear-gradient(135deg, #78350f 0%, #92400e 100%)'
        : 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
      color: isDark ? '#fbbf24' : '#b45309',
    },
    bolt: {
      bg: isDark
        ? 'linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)'
        : 'linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)',
      color: isDark ? '#fb923c' : '#c2410c',
    },
    email: {
      bg: isDark
        ? 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)'
        : 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
      color: isDark ? '#93c5fd' : '#1d4ed8',
    },
    security: {
      bg: isDark
        ? 'linear-gradient(135deg, #14532d 0%, #166534 100%)'
        : 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)',
      color: isDark ? '#86efac' : '#15803d',
    },
  };

  return (
    <MuiPublicLayout>
      <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
        <PageHeader
          title="About Time to Just"
          description="Reclaim your time with AI-powered email assistance"
          centered
        />

        <Stack spacing={3} sx={{ mb: 8, maxWidth: 700, mx: 'auto' }}>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, textAlign: 'center' }}>
            Time to Just is an AI email assistant that learns your unique writing style and helps
            you respond to emails faster. We believe your time is valuable and should be spent on
            what matters most to you—not drowning in your inbox.
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, textAlign: 'center' }}>
            Our intelligent system analyzes your past emails to understand how you communicate
            with different people and in different contexts, then generates draft replies that
            sound authentically like you.
          </Typography>
        </Stack>

        <Typography variant="h5" align="center" sx={{ mb: 4 }}>
          Why Choose Time to Just?
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 3,
            mb: 8,
          }}
        >
          <FeatureCard
            icon={<PsychologyIcon sx={{ color: iconStyles.psychology.color, fontSize: 26 }} />}
            iconBg={iconStyles.psychology.bg}
            title="Personalized AI"
            description="Our AI learns your tone, vocabulary, and communication patterns. Every draft sounds like you wrote it because the AI was trained on your style."
          />
          <FeatureCard
            icon={<BoltIcon sx={{ color: iconStyles.bolt.color, fontSize: 26 }} />}
            iconBg={iconStyles.bolt.bg}
            title="Save Hours Weekly"
            description="Stop spending hours crafting responses. Review and send AI-generated drafts in seconds, freeing up time for what matters."
          />
          <FeatureCard
            icon={<EmailIcon sx={{ color: iconStyles.email.color, fontSize: 26 }} />}
            iconBg={iconStyles.email.bg}
            title="Smart Organization"
            description="Automatically categorize emails, detect spam, and prioritize what needs your attention. Focus on emails that matter."
          />
          <FeatureCard
            icon={<SecurityIcon sx={{ color: iconStyles.security.color, fontSize: 26 }} />}
            iconBg={iconStyles.security.bg}
            title="Privacy First"
            description="Your email data stays secure with encrypted storage and OAuth authentication. We never share your data with third parties."
          />
        </Box>

        <Stack spacing={2} alignItems="center">
          <Typography variant="h5">
            Ready to reclaim your time?
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Join thousands of professionals who have simplified their email workflow.
          </Typography>
          <Button
            component={Link}
            href="/signup"
            variant="contained"
            size="large"
            endIcon={<ArrowForwardIcon />}
            sx={{
              mt: 2,
              px: 4,
              py: 1.5,
              background: isDark
                ? 'linear-gradient(135deg, #3b6fb6 0%, #6366f1 100%)'
                : 'linear-gradient(135deg, #0B2648 0%, #2d5a9a 100%)',
              boxShadow: isDark
                ? '0 4px 14px rgba(89, 133, 193, 0.35)'
                : '0 4px 14px rgba(11, 38, 72, 0.35)',
              '&:hover': {
                background: isDark
                  ? 'linear-gradient(135deg, #5985c1 0%, #818cf8 100%)'
                  : 'linear-gradient(135deg, #1e4577 0%, #3b6fb6 100%)',
                boxShadow: isDark
                  ? '0 6px 20px rgba(89, 133, 193, 0.45)'
                  : '0 6px 20px rgba(11, 38, 72, 0.45)',
              },
            }}
          >
            Get Started Free
          </Button>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
