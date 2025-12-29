'use client';

import { Box, Container, Typography, Paper, Stack, Divider, List, ListItem, ListItemText } from '@mui/material';
import { MuiPublicLayout, PageHeader } from '@/components/mui';
import { usePageTitle } from '@/hooks/use-page-title';

export default function MuiLegalPage() {
  usePageTitle('Legal');
  return (
    <MuiPublicLayout>
      <Container maxWidth="md" sx={{ py: 8 }}>
        <PageHeader title="Legal" />

        <Stack spacing={4}>
          {/* Terms of Service */}
          <Paper sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>
              Terms of Service
            </Typography>
            <Stack spacing={3}>
              <Typography variant="body2">
                By using Time to Just, you agree to these terms. Please read them carefully.
              </Typography>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  1. Service Description
                </Typography>
                <Typography variant="body2">
                  Time to Just provides AI-powered email assistance, including draft generation, email
                  organization, and spam detection. The service requires access to your email account
                  to function.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  2. User Responsibilities
                </Typography>
                <Typography variant="body2">
                  You are responsible for maintaining the security of your account credentials and for
                  all activities that occur under your account. You agree to use the service only for
                  lawful purposes.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  3. Service Availability
                </Typography>
                <Typography variant="body2">
                  We strive to maintain high availability but do not guarantee uninterrupted service.
                  We may modify or discontinue features with reasonable notice.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  4. Limitation of Liability
                </Typography>
                <Typography variant="body2">
                  Time to Just is provided &quot;as is&quot; without warranties. We are not liable for
                  any indirect, incidental, or consequential damages arising from your use of the
                  service.
                </Typography>
              </Box>
            </Stack>
          </Paper>

          {/* Privacy Policy */}
          <Paper sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>
              Privacy Policy
            </Typography>
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Data We Collect
                </Typography>
                <Typography variant="body2">
                  We collect email content and metadata necessary to provide our services, including
                  sender/recipient information, subject lines, and message bodies. We also collect
                  account information you provide during registration.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  How We Use Your Data
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Your email data is used exclusively to:
                </Typography>
                <List dense disablePadding sx={{ pl: 2 }}>
                  <ListItem disableGutters>
                    <ListItemText
                      primary="Analyze your writing style to generate personalized drafts"
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem disableGutters>
                    <ListItemText
                      primary="Categorize and organize incoming emails"
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem disableGutters>
                    <ListItemText
                      primary="Detect spam and unwanted messages"
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                  <ListItem disableGutters>
                    <ListItemText
                      primary="Improve our AI models (using anonymized, aggregated data only)"
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                </List>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Data Security
                </Typography>
                <Typography variant="body2">
                  We implement industry-standard security measures including encryption at rest and in
                  transit, secure OAuth authentication, and regular security audits. We never store
                  your email password when using OAuth.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Data Sharing
                </Typography>
                <Typography variant="body2">
                  We do not sell your personal data. We may share data with service providers who
                  assist in operating our service, subject to strict confidentiality agreements.
                </Typography>
              </Box>

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Your Rights
                </Typography>
                <Typography variant="body2">
                  You may request access to, correction of, or deletion of your personal data at any
                  time by contacting us. Upon account deletion, we will remove your data within 30
                  days.
                </Typography>
              </Box>
            </Stack>
          </Paper>

          {/* Cookie Policy */}
          <Paper sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>
              Cookie Policy
            </Typography>
            <Typography variant="body2">
              We use essential cookies to maintain your session and remember your preferences. We
              do not use tracking cookies or third-party advertising cookies.
            </Typography>
          </Paper>

          {/* Last Updated */}
          <Divider />
          <Typography variant="body2">
            Last updated: December 2024
          </Typography>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
