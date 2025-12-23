'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Box,
  Paper,
  Typography,
  Tabs,
  Tab,
  Chip,
  Skeleton,
  Alert,
  AlertTitle,
  Button,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import Link from 'next/link';
import PostalMime from 'postal-mime';
import { useAuth } from '@/lib/auth-context';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { MuiAuthenticatedLayout } from '@/components/mui';
import { RelationshipSelector } from '../mui-dashboard/components/relationship-selector';
import { EmailActionType } from '../../../../../server/src/types/email-action-tracking';
import type { SpamCheckResult } from '../../../../../server/src/lib/pipeline/types';

// Types
interface ParsedEmail {
  headers: Array<{ key: string; value: string }>;
  from: { name?: string; address: string };
  to: Array<{ name?: string; address: string }>;
  cc?: Array<{ name?: string; address: string }>;
  subject: string;
  date: Date;
  text?: string;
  html?: string;
  attachments: Array<{
    filename: string | null;
    mimeType: string;
    disposition: 'attachment' | 'inline' | null;
    related?: boolean;
    description?: string;
    contentId?: string;
    method?: string;
    content: ArrayBuffer | string;
    encoding?: 'base64' | 'utf8';
  }>;
}

interface EmailData {
  messageId: string;
  subject: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  date: string;
  rawMessage: string;
  uid?: number;
  flags: string[];
  size: number;
  actionTaken?: EmailActionType;
}

interface LlmResponse {
  meta: {
    recommendedAction: EmailActionType;
    keyConsiderations: string[];
    contextFlags: {
      isThreaded: boolean;
      hasAttachments: boolean;
      isGroupEmail: boolean;
      inboundMsgAddressedTo: 'you' | 'group' | 'someone-else';
      urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
    };
  };
  generatedAt: string;
  providerId: string;
  modelName: string;
  draftId: string;
  body?: string;
  bodyHtml?: string;
  relationship: {
    type: string;
    confidence: number;
  };
  spamAnalysis: SpamCheckResult;
}

// Shadow DOM component to isolate email HTML styles from the rest of the page
function IsolatedEmailContent({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear any existing shadow root content
    const existing = containerRef.current.shadowRoot;
    if (existing) {
      existing.innerHTML = '';
    }

    // Create shadow root if it doesn't exist
    const shadowRoot = existing || containerRef.current.attachShadow({ mode: 'open' });

    // Add base styles for the shadow DOM content
    const styles = `
      <style>
        :host {
          display: block;
          text-align: left;
        }
        * {
          font-family: "Roboto", "Helvetica", "Arial", sans-serif;
        }
        img {
          max-width: 100%;
          height: auto;
        }
        a {
          color: #1976d2;
          text-decoration: underline;
        }
        table {
          border-collapse: collapse;
          max-width: 100%;
        }
      </style>
    `;

    shadowRoot.innerHTML = styles + html;
  }, [html]);

  return <div ref={containerRef} />;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Tab panel component
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

function InboxContent() {
  const { user, signOut } = useAuth();
  const { error: showError } = useMuiToast();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [emailData, setEmailData] = useState<EmailData | null>(null);
  const [parsedMessage, setParsedMessage] = useState<ParsedEmail | null>(null);
  const [llmResponse, setLlmResponse] = useState<LlmResponse | null>(null);

  // URL parameters (required)
  const emailAccountId = searchParams.get('emailAccountId');
  const messageId = searchParams.get('messageId');

  // Fetch email when URL parameters are available
  useEffect(() => {
    if (emailAccountId && messageId) {
      fetchEmail(emailAccountId, messageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailAccountId, messageId]);

  // Parse email when raw message changes
  useEffect(() => {
    if (emailData?.rawMessage) {
      parseMessage(emailData.rawMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailData]);

  const fetchEmail = async (accountId: string, msgId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/inbox/email/${accountId}/${encodeURIComponent(msgId)}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load email');
      }

      const data = await response.json();

      if (data.success && data.email) {
        setEmailData(data.email);
        setLlmResponse(data.email.llmResponse || null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load email';
      showError(errorMessage);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const parseMessage = async (rawMessage: string) => {
    try {
      const parser = new PostalMime();
      const parsed = await parser.parse(rawMessage);

      // Convert headers to array format
      const headersArray: Array<{ key: string; value: string }> = [];

      if (Array.isArray(parsed.headers)) {
        parsed.headers.forEach((header: unknown) => {
          if (header && typeof header === 'object' && 'key' in header && 'value' in header) {
            const headerValue = Array.isArray(header.value)
              ? header.value.join(', ')
              : String(header.value);
            headersArray.push({ key: String(header.key), value: headerValue });
          }
        });
      } else if (parsed.headers && typeof parsed.headers === 'object') {
        Object.entries(parsed.headers).forEach(([key, value]) => {
          const headerValue = Array.isArray(value) ? value.join(', ') : String(value);
          headersArray.push({ key, value: headerValue });
        });
      }

      setParsedMessage({
        headers: headersArray,
        from: {
          address: parsed.from?.address || '',
          name: parsed.from?.name || undefined,
        },
        to: (parsed.to || []).map((addr) => ({
          address: addr.address || '',
          name: addr.name || undefined,
        })),
        cc: parsed.cc
          ? parsed.cc.map((addr) => ({
              address: addr.address || '',
              name: addr.name || undefined,
            }))
          : undefined,
        subject: parsed.subject || '',
        date: parsed.date ? new Date(parsed.date) : new Date(),
        text: parsed.text,
        html: parsed.html,
        attachments: parsed.attachments || [],
      });
    } catch (err) {
      console.error('Failed to parse message:', err);
      showError('Failed to parse email message');
    }
  };

  // Show nothing while loading auth
  if (!user) return null;

  // Show error if URL parameters are missing
  if (!emailAccountId || !messageId) {
    return (
      <MuiAuthenticatedLayout user={user} onSignOut={signOut}>
        <Alert severity="error" icon={<ErrorOutlineIcon />}>
          <AlertTitle>Missing Parameters</AlertTitle>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This page requires email account ID and message ID parameters.
          </Typography>
          <Button
            component={Link}
            href="/poc/mui-dashboard"
            variant="outlined"
            size="small"
          >
            Go to Dashboard
          </Button>
        </Alert>
      </MuiAuthenticatedLayout>
    );
  }

  return (
    <MuiAuthenticatedLayout user={user} onSignOut={signOut}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Message Analysis
      </Typography>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Analysis" />
          <Tab label="Message" />
        </Tabs>
      </Box>

      {/* Analysis Tab */}
      <TabPanel value={activeTab} index={0}>
        {llmResponse && emailData ? (
          <Paper sx={{ p: 3 }}>
            {/* Email metadata header */}
            <Typography variant="h6" gutterBottom>
              Analysis
            </Typography>
            <Box sx={{ color: 'text.secondary', mb: 3 }}>
              <Typography variant="body2">To: {emailData.to.join(', ')}</Typography>
              {emailData.cc && emailData.cc.length > 0 && (
                <Typography variant="body2">CC: {emailData.cc.join(', ')}</Typography>
              )}
              <Typography variant="body2">Subject: {emailData.subject}</Typography>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                <Typography variant="body2">Relationship:</Typography>
                <RelationshipSelector
                  emailAddress={emailData.from}
                  currentRelationship={llmResponse.relationship.type}
                />
                <Typography variant="caption">
                  ({Math.round(llmResponse.relationship.confidence * 100)}% confidence)
                </Typography>
              </Stack>
            </Box>

            {/* Draft body */}
            {llmResponse.body ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography
                  component="pre"
                  sx={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', m: 0 }}
                >
                  {llmResponse.body}
                </Typography>
              </Paper>
            ) : (
              <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', bgcolor: 'action.hover' }}>
                <Typography variant="body2" color="text.secondary">
                  No draft body - email was filed automatically
                </Typography>
              </Paper>
            )}

            {/* AI Analysis Metadata */}
            {llmResponse.meta && (
              <Box sx={{ mt: 4 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <PsychologyIcon color="action" />
                    <Typography variant="subtitle1" fontWeight="medium">
                      AI Analysis
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    Message ID: {emailData.messageId}
                  </Typography>
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  {/* Left Column */}
                  <Box sx={{ flex: 1 }}>
                    {/* Spam Analysis */}
                    {llmResponse.spamAnalysis && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary" fontWeight="medium" gutterBottom>
                          Spam Analysis
                        </Typography>
                        <Chip
                          label={
                            llmResponse.spamAnalysis.isSpam
                              ? `Spam${llmResponse.spamAnalysis.senderResponseCount > 0 ? ` (replied ${llmResponse.spamAnalysis.senderResponseCount}x)` : ''}`
                              : `Not Spam${llmResponse.spamAnalysis.senderResponseCount > 0 ? ` (replied ${llmResponse.spamAnalysis.senderResponseCount}x)` : ''}`
                          }
                          color={llmResponse.spamAnalysis.isSpam ? 'error' : 'success'}
                          size="small"
                          title={llmResponse.spamAnalysis.indicators.join('\n')}
                        />
                      </Box>
                    )}

                    {/* Recommended Action */}
                    <Box>
                      <Typography variant="body2" color="text.secondary" fontWeight="medium" gutterBottom>
                        Recommended Action
                      </Typography>
                      <Chip
                        label={EmailActionType.LABELS[llmResponse.meta.recommendedAction]}
                        size="small"
                        sx={{
                          bgcolor: EmailActionType.COLORS[llmResponse.meta.recommendedAction],
                          color: 'white',
                        }}
                      />
                    </Box>
                  </Box>

                  {/* Right Column */}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" color="text.secondary" fontWeight="medium" gutterBottom>
                      Context Flags
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      <Chip
                        label={`${llmResponse.meta.contextFlags.isThreaded ? '✓' : '✗'} Threaded`}
                        variant={llmResponse.meta.contextFlags.isThreaded ? 'filled' : 'outlined'}
                        size="small"
                      />
                      <Chip
                        label={`${llmResponse.meta.contextFlags.hasAttachments ? '✓' : '✗'} Attachments`}
                        variant={llmResponse.meta.contextFlags.hasAttachments ? 'filled' : 'outlined'}
                        size="small"
                      />
                      <Chip
                        label={`${llmResponse.meta.contextFlags.isGroupEmail ? '✓' : '✗'} Group Email`}
                        variant={llmResponse.meta.contextFlags.isGroupEmail ? 'filled' : 'outlined'}
                        size="small"
                      />
                      <Chip
                        label={`To: ${llmResponse.meta.contextFlags.inboundMsgAddressedTo}`}
                        variant="outlined"
                        size="small"
                      />
                      <Chip
                        label={`Urgency: ${llmResponse.meta.contextFlags.urgencyLevel}`}
                        color={
                          llmResponse.meta.contextFlags.urgencyLevel === 'critical'
                            ? 'error'
                            : llmResponse.meta.contextFlags.urgencyLevel === 'high'
                              ? 'warning'
                              : 'default'
                        }
                        size="small"
                      />
                    </Stack>
                  </Box>
                </Stack>

                {/* Key Considerations */}
                {Array.isArray(llmResponse.meta?.keyConsiderations) &&
                  llmResponse.meta.keyConsiderations.length > 0 && (
                    <Box sx={{ mt: 3 }}>
                      <Typography variant="body2" color="text.secondary" fontWeight="medium" gutterBottom>
                        Key Considerations
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {llmResponse.meta.keyConsiderations.map((consideration, idx) => (
                          <Typography component="li" variant="body2" color="text.secondary" key={idx}>
                            {consideration}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  )}
              </Box>
            )}
          </Paper>
        ) : loading ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">Loading analysis...</Typography>
          </Paper>
        ) : (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No analysis available for this email</Typography>
            {emailData?.actionTaken && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Action taken: {EmailActionType.LABELS[emailData.actionTaken]}
              </Typography>
            )}
          </Paper>
        )}
      </TabPanel>

      {/* Message Tab */}
      <TabPanel value={activeTab} index={1}>
        {loading ? (
          <Paper sx={{ p: 3 }}>
            <Skeleton variant="text" width="60%" height={32} sx={{ mb: 1 }} />
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="text" width="50%" />
            <Skeleton variant="rectangular" height={200} sx={{ mt: 2 }} />
          </Paper>
        ) : emailData && parsedMessage ? (
          <Paper sx={{ p: 3 }}>
            {/* Email header */}
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }}>
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="h6">
                    {parsedMessage.subject || '(No subject)'}
                  </Typography>
                  {emailData.actionTaken && emailData.actionTaken !== EmailActionType.PENDING && (
                    <Chip
                      label={EmailActionType.LABELS[emailData.actionTaken]}
                      size="small"
                      sx={{
                        bgcolor: EmailActionType.COLORS[emailData.actionTaken],
                        color: 'white',
                      }}
                    />
                  )}
                </Stack>
                <Box sx={{ color: 'text.secondary' }}>
                  <Typography variant="body2">
                    From:{' '}
                    {parsedMessage.from.name
                      ? `${parsedMessage.from.name} <${parsedMessage.from.address}>`
                      : parsedMessage.from.address}
                  </Typography>
                  <Typography variant="body2">
                    To:{' '}
                    {parsedMessage.to
                      .map((addr) => (addr.name ? `${addr.name} <${addr.address}>` : addr.address))
                      .join(', ')}
                  </Typography>
                  {parsedMessage.cc && parsedMessage.cc.length > 0 && (
                    <Typography variant="body2">
                      CC:{' '}
                      {parsedMessage.cc
                        .map((addr) => (addr.name ? `${addr.name} <${addr.address}>` : addr.address))
                        .join(', ')}
                    </Typography>
                  )}
                  <Typography variant="body2">
                    Date: {new Date(parsedMessage.date).toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            </Stack>

            {/* Headers accordion */}
            <Accordion disableGutters sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2" fontWeight="medium">
                  Email Headers ({parsedMessage.headers.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box
                  sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    p: 2,
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    overflowX: 'auto',
                  }}
                >
                  {parsedMessage.headers.map((header, idx) => (
                    <Box key={idx} sx={{ mb: 0.5 }}>
                      <Typography component="span" sx={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: 'inherit' }}>
                        {header.key}:
                      </Typography>{' '}
                      <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: 'inherit' }}>
                        {header.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>

            <Divider sx={{ my: 2 }} />

            {/* Attachments */}
            {parsedMessage.attachments.length > 0 && (
              <>
                <Box sx={{ mb: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <AttachFileIcon fontSize="small" />
                    <Typography variant="body2" fontWeight="medium">
                      Attachments ({parsedMessage.attachments.length})
                    </Typography>
                  </Stack>
                  <List dense disablePadding>
                    {parsedMessage.attachments.map((attachment, idx) => (
                      <ListItem key={idx} sx={{ bgcolor: 'action.hover', borderRadius: 1, mb: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <InsertDriveFileIcon fontSize="small" color="action" />
                        </ListItemIcon>
                        <ListItemText
                          primary={attachment.filename || 'Unnamed'}
                          secondary={
                            attachment.mimeType +
                            (attachment.content &&
                            typeof attachment.content !== 'string'
                              ? ` • ${formatFileSize(attachment.content.byteLength)}`
                              : '')
                          }
                          primaryTypographyProps={{ variant: 'body2' }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Box>
                <Divider sx={{ my: 2 }} />
              </>
            )}

            {/* Email body - Shadow DOM isolates email styles from page */}
            <Box>
              {parsedMessage.html ? (
                <IsolatedEmailContent html={parsedMessage.html} />
              ) : parsedMessage.text ? (
                <Typography
                  component="pre"
                  sx={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', m: 0 }}
                >
                  {parsedMessage.text}
                </Typography>
              ) : (
                <Typography color="text.secondary">No content available</Typography>
              )}
            </Box>
          </Paper>
        ) : (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">Failed to load email</Typography>
          </Paper>
        )}
      </TabPanel>
    </MuiAuthenticatedLayout>
  );
}

export default function MuiInboxPage() {
  return (
    <Suspense
      fallback={
        <Box sx={{ p: 6, textAlign: 'center' }}>
          <Typography>Loading...</Typography>
        </Box>
      }
    >
      <InboxContent />
    </Suspense>
  );
}
