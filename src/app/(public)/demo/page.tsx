'use client';

import Link from 'next/link';
import { Box, Container, Typography, Paper, Stack, Chip, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { MuiPublicLayout, PageHeader } from '@/components/mui';
import { usePageTitle } from '@/hooks/use-page-title';

interface StepProps {
  step: number;
  title: string;
  children: React.ReactNode;
}

function Step({ step, title, children }: StepProps) {
  return (
    <Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Chip
          label={`Step ${step}`}
          color="primary"
          variant="outlined"
          sx={{ fontWeight: 600, borderRadius: 2 }}
        />
        <Typography variant="h5">
          {title}
        </Typography>
      </Stack>
      <Paper sx={{ p: 3 }}>{children}</Paper>
    </Box>
  );
}

export default function MuiDemoPage() {
  usePageTitle('How It Works');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <MuiPublicLayout>
      <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
        <PageHeader
          title="How It Works"
          description="See Time to Just in action"
          centered
        />

        <Stack spacing={6}>
          <Step step={1} title="Connect Your Email">
            <Stack spacing={2}>
              <Typography variant="body2">
                Securely connect your Gmail account with OAuth (no password stored) or use IMAP
                credentials for other providers. Your connection is encrypted and secure.
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                <Typography color="success.main">Connected: john@gmail.com</Typography>
                <Typography>Last sync: 2 minutes ago</Typography>
                <Typography>Monitoring: Active</Typography>
              </Paper>
            </Stack>
          </Step>

          <Step step={2} title="AI Learns Your Style">
            <Stack spacing={2}>
              <Typography variant="body2">
                Time to Just analyzes your sent emails to learn how you communicate. It identifies
                your tone, common phrases, greeting styles, and signature patterns.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Tone Analysis</Typography>
                  <Stack spacing={0.5}>
                    <Typography variant="body2">Professional: 85%</Typography>
                    <Typography variant="body2">Friendly: 72%</Typography>
                    <Typography variant="body2">Concise: 90%</Typography>
                  </Stack>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Writing Patterns</Typography>
                  <Stack spacing={0.5}>
                    <Typography variant="body2">Avg. length: 3-4 sentences</Typography>
                    <Typography variant="body2">Common greeting: &quot;Hi&quot;</Typography>
                    <Typography variant="body2">Sign-off: &quot;Best,&quot;</Typography>
                  </Stack>
                </Paper>
              </Box>
            </Stack>
          </Step>

          <Step step={3} title="Automatic Draft Generation">
            <Stack spacing={2}>
              <Typography variant="body2">
                When new emails arrive, Time to Just automatically generates personalized reply
                drafts. Each draft matches your communication style for that relationship.
              </Typography>
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="subtitle2">Incoming Email</Typography>
                  <Typography variant="body2">From: sarah@company.com</Typography>
                </Box>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2">
                    &quot;Hi, can we reschedule our meeting to Thursday at 2pm?&quot;
                  </Typography>
                </Box>
                <Box sx={{ p: 2, bgcolor: 'primary.50', borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="subtitle2" color="primary">AI-Generated Draft</Typography>
                </Box>
                <Box sx={{ p: 2, bgcolor: 'primary.50', opacity: 0.7 }}>
                  <Typography variant="body2">&quot;Hi Sarah,</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Thursday at 2pm works great for me. I&apos;ll update the calendar invite.
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Best,<br />John&quot;
                  </Typography>
                </Box>
              </Paper>
            </Stack>
          </Step>

          <Step step={4} title="Review and Send">
            <Stack spacing={2}>
              <Typography variant="body2">
                Review AI-generated drafts in your email client&apos;s drafts folder. Edit if
                needed, then send. Time to Just learns from your edits to improve future drafts.
              </Typography>
              <Stack direction="row" spacing={3} flexWrap="wrap">
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.main' }} />
                  <Typography variant="body2">Draft ready in drafts folder</Typography>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'info.main' }} />
                  <Typography variant="body2">Edit as needed</Typography>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'primary.main' }} />
                  <Typography variant="body2">Send when ready</Typography>
                </Stack>
              </Stack>
            </Stack>
          </Step>

          <Stack spacing={2} alignItems="center" sx={{ mt: 4 }}>
            <Typography variant="h5">
              Ready to try it yourself?
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Sign up for free and experience the future of email management.
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
              Get Started
            </Button>
          </Stack>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
