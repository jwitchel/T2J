'use client';

import { Box, Container, Typography, Paper, Stack, Button } from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import BoltIcon from '@mui/icons-material/Bolt';
import EmailIcon from '@mui/icons-material/Email';
import SecurityIcon from '@mui/icons-material/Security';
import { MuiPublicLayout, PageHeader } from '@/components/mui';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        {icon}
        <Typography variant="h6">{title}</Typography>
      </Stack>
      <Typography variant="body2">{description}</Typography>
    </Paper>
  );
}

export default function MuiAboutPage() {
  return (
    <MuiPublicLayout>
      <Container maxWidth="md" sx={{ py: 8 }}>
        <PageHeader
          title="About Time to Just"
          description="Reclaim your time with AI-powered email assistance"
          centered
        />

        <Stack spacing={3} sx={{ mb: 6 }}>
          <Typography variant="body1">
            Time to Just is an AI email assistant that learns your unique writing style and helps
            you respond to emails faster. We believe your time is valuable and should be spent on
            what matters most to you—not drowning in your inbox.
          </Typography>
          <Typography variant="body1">
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
            mb: 6,
          }}
        >
          <FeatureCard
            icon={<PsychologyIcon color="primary" />}
            title="Personalized AI"
            description="Our AI learns your tone, vocabulary, and communication patterns. Every draft sounds like you wrote it because the AI was trained on your style."
          />
          <FeatureCard
            icon={<BoltIcon color="warning" />}
            title="Save Hours Weekly"
            description="Stop spending hours crafting responses. Review and send AI-generated drafts in seconds, freeing up time for what matters."
          />
          <FeatureCard
            icon={<EmailIcon color="info" />}
            title="Smart Organization"
            description="Automatically categorize emails, detect spam, and prioritize what needs your attention. Focus on emails that matter."
          />
          <FeatureCard
            icon={<SecurityIcon color="success" />}
            title="Privacy First"
            description="Your email data stays secure with encrypted storage and OAuth authentication. We never share your data with third parties."
          />
        </Box>

        <Stack spacing={1} alignItems="center">
          <Typography variant="h5">Ready to reclaim your time?</Typography>
          <Typography variant="body1">
            Join thousands of professionals who have simplified their email workflow.
          </Typography>
          <Button variant="contained" size="large" href="/poc/mui-signup" sx={{ mt: 2 }}>
            Get Started Free
          </Button>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
