'use client';

import { Box, Container, Typography, Paper, Stack, Link } from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FeedbackIcon from '@mui/icons-material/Feedback';
import { MuiPublicLayout, PageHeader } from '@/components/mui';

interface ContactCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function ContactCard({ icon, title, children }: ContactCardProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        {icon}
        <Typography variant="h6">{title}</Typography>
      </Stack>
      {children}
    </Paper>
  );
}

export default function MuiContactPage() {
  return (
    <MuiPublicLayout>
      <Container maxWidth="md" sx={{ py: 8 }}>
        <PageHeader
          title="Contact Us"
          description="We'd love to hear from you"
          centered
        />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 3,
            mb: 4,
          }}
        >
          <ContactCard icon={<EmailIcon color="primary" />} title="Email Support">
            <Stack spacing={2}>
              <Typography variant="body2">
                For general inquiries, technical support, or account issues.
              </Typography>
              <Link href="mailto:support@timetojust.com" underline="hover">
                support@timetojust.com
              </Link>
            </Stack>
          </ContactCard>

          <ContactCard icon={<AccessTimeIcon color="warning" />} title="Response Time">
            <Typography variant="body2">
              We typically respond within 24-48 hours during business days. For urgent issues,
              please include &quot;URGENT&quot; in your subject line.
            </Typography>
          </ContactCard>
        </Box>

        <ContactCard icon={<FeedbackIcon color="success" />} title="Feedback">
          <Stack spacing={2}>
            <Typography variant="body2">
              Have ideas to improve Time to Just? We value your feedback and suggestions. Let us
              know what features you&apos;d like to see or how we can make your experience better.
            </Typography>
            <Link href="mailto:feedback@timetojust.com" underline="hover">
              feedback@timetojust.com
            </Link>
          </Stack>
        </ContactCard>

        <Stack spacing={1} alignItems="center" sx={{ mt: 6 }}>
          <Typography variant="h6">Before You Reach Out</Typography>
          <Typography variant="body2">
            Check our{' '}
            <Link href="/poc/mui-faq" underline="hover">
              FAQ page
            </Link>{' '}
            for answers to common questions.
          </Typography>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
