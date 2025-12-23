'use client';

import { Box, Container, Typography, Accordion, AccordionSummary, AccordionDetails, Stack, Link } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { MuiPublicLayout, PageHeader } from '@/components/mui';

const faqs = [
  {
    question: 'How does Time to Just learn my writing style?',
    answer:
      'Time to Just analyzes your sent emails to understand your unique communication patterns. It learns your tone, vocabulary, greeting styles, sign-offs, and how you communicate differently with various contacts (e.g., more casual with friends, more formal with clients).',
  },
  {
    question: 'Is my email data secure?',
    answer:
      'Yes, security is our top priority. We use OAuth for Gmail connections (your password is never stored), encrypt all data at rest and in transit, and never share your email content with third parties. Your data is only used to generate personalized drafts for you.',
  },
  {
    question: 'Which email providers are supported?',
    answer:
      'Time to Just supports Gmail (via secure OAuth), Outlook/Office 365, Yahoo Mail, iCloud, and any email provider that supports IMAP. For Gmail, we recommend OAuth for the most secure connection.',
  },
  {
    question: 'Where do the draft replies appear?',
    answer:
      "Draft replies are automatically saved to your email provider's Drafts folder. You can find them there, review and edit as needed, then send directly from your regular email client.",
  },
  {
    question: 'Can I edit the AI-generated drafts?',
    answer:
      'Absolutely! The drafts are starting points designed to save you time. You can edit them as much as you want before sending. Time to Just also learns from your edits to improve future suggestions.',
  },
  {
    question: "What happens to emails I don't want to reply to?",
    answer:
      'Time to Just intelligently categorizes your emails. Spam is automatically detected and moved. FYI-only emails, large distribution lists, and newsletters are organized without generating drafts. You control which categories get automatic draft generation.',
  },
  {
    question: 'How accurate are the generated drafts?',
    answer:
      'Draft accuracy improves over time as the AI learns more about your style. Most users find they need to make only minor edits, if any. The system is particularly good at matching your tone for people you email frequently.',
  },
  {
    question: 'Can I use Time to Just with multiple email accounts?',
    answer:
      'Yes! You can connect multiple email accounts and Time to Just will learn the different styles you use for each. This is great if you have separate work and personal emails.',
  },
  {
    question: 'What if I want to disable draft generation temporarily?',
    answer:
      'You can easily toggle draft generation on/off in Settings. You can also disable specific processing features like spam detection or email organization independently.',
  },
  {
    question: 'How do I get started?',
    answer:
      "Simply sign up for a free account, connect your email via OAuth (recommended for Gmail) or IMAP, and Time to Just will begin learning your style immediately. You'll start seeing drafts for new emails within minutes.",
  },
];

export default function MuiFaqPage() {
  return (
    <MuiPublicLayout>
      <Container maxWidth="md" sx={{ py: 8 }}>
        <PageHeader
          title="Frequently Asked Questions"
          description="Everything you need to know about Time to Just"
          centered
        />

        <Box>
          {faqs.map((faq, index) => (
            <Accordion key={index} disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1">{faq.question}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2">{faq.answer}</Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>

        <Stack spacing={1} alignItems="center" sx={{ mt: 6 }}>
          <Typography variant="h6">Still have questions?</Typography>
          <Typography variant="body2">
            Contact us at{' '}
            <Link href="mailto:support@timetojust.com" underline="hover">
              support@timetojust.com
            </Link>{' '}
            and we&apos;ll be happy to help.
          </Typography>
        </Stack>
      </Container>
    </MuiPublicLayout>
  );
}
