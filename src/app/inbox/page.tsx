'use client';

import { useState, useEffect, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Paperclip, FileText, Send, Loader2, Brain, AlertCircle, FolderOpen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PostalMime from 'postal-mime';
import { apiGet, apiPost } from '@/lib/api';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSearchParams } from 'next/navigation';
import { EmailActions, RecommendedAction } from '../../../server/src/lib/email-actions';
import type { SpamCheckResult } from '../../../server/src/lib/pipeline/types';
import type { EmailActionType } from '../../../server/src/types/email-action-tracking';

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
    disposition: "attachment" | "inline" | null;
    related?: boolean;
    description?: string;
    contentId?: string;
    method?: string;
    content: ArrayBuffer | string;
    encoding?: "base64" | "utf8";
  }>;
}

interface GeneratedDraft {
  id: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo: string;
  references: string;
  meta?: {
    recommendedAction: RecommendedAction;
    keyConsiderations: string[];
    contextFlags: {
      isThreaded: boolean;
      hasAttachments: boolean;
      isGroupEmail: boolean;
      inboundMsgAddressedTo: 'you' | 'group' | 'someone-else';
      urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
    };
  };
  relationship: {
    type: string;
    confidence: number;
  };
  draftMetadata: {
    originalSubject: string;
    originalFrom: string;
    spamAnalysis: SpamCheckResult;
    exampleCount: number;
    timestamp: string;
  };
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

function InboxContent() {
  const { error, success } = useToast();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('message');
  const [emailData, setEmailData] = useState<EmailData | null>(null);
  const [parsedMessage, setParsedMessage] = useState<ParsedEmail | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedDraft | null>(null);

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
      const data = await apiGet<{
        success: boolean;
        email: {
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
          llmResponse?: {
            meta: {
              recommendedAction: RecommendedAction;
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
          };
        };
      }>(`/api/inbox/email/${accountId}/${encodeURIComponent(msgId)}`);

      if (data.success && data.email) {
        setEmailData(data.email);

        // If llmResponse exists, convert it to GeneratedDraft format
        if (data.email.llmResponse) {
          const draft: GeneratedDraft = {
            id: data.email.llmResponse.draftId,
            from: '',
            to: data.email.to.join(', '),
            cc: data.email.cc?.join(', ') || '',
            subject: data.email.subject,
            body: data.email.llmResponse.body || '',
            bodyHtml: data.email.llmResponse.bodyHtml,
            inReplyTo: data.email.messageId,
            references: data.email.messageId,
            meta: data.email.llmResponse.meta,
            relationship: data.email.llmResponse.relationship,
            draftMetadata: {
              originalSubject: data.email.subject,
              originalFrom: data.email.from,
              spamAnalysis: data.email.llmResponse.spamAnalysis,
              exampleCount: 0,
              timestamp: data.email.llmResponse.generatedAt
            }
          };

          setGeneratedDraft(draft);
          setActiveTab('analysis');
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load email';
      error(errorMessage);
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
            const headerValue = Array.isArray(header.value) ? header.value.join(', ') : String(header.value);
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
          name: parsed.from?.name || undefined
        },
        to: (parsed.to || []).map(addr => ({
          address: addr.address || '',
          name: addr.name || undefined
        })),
        cc: parsed.cc ? parsed.cc.map(addr => ({
          address: addr.address || '',
          name: addr.name || undefined
        })) : undefined,
        subject: parsed.subject || '',
        date: parsed.date ? new Date(parsed.date) : new Date(),
        text: parsed.text,
        html: parsed.html,
        attachments: parsed.attachments || []
      });
    } catch (err) {
      console.error('Failed to parse message:', err);
      error('Failed to parse email message');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Show error if URL parameters are missing
  if (!emailAccountId || !messageId) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
          <AlertCircle />
          <AlertTitle>Missing Parameters</AlertTitle>
          <AlertDescription>
            This page requires email account ID and message ID parameters.
            <Link href="/dashboard">
              <Button size="sm" variant="outline" className="mt-2">Go to Dashboard</Button>
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6" style={{ textAlign: 'left' }}>
        <h1 className="text-2xl font-bold mb-2" style={{ textAlign: 'left' }}>Message Analysis</h1>
      </div>

      {/* Email display with tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="analysis" disabled={!generatedDraft}>
            Analysis
          </TabsTrigger>
          <TabsTrigger value="message">Message</TabsTrigger>
        </TabsList>

        <TabsContent value="message">
          {loading ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ) : emailData && parsedMessage ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{parsedMessage.subject || '(No subject)'}</CardTitle>
                      {emailData.actionTaken && emailData.actionTaken !== 'none' && (
                        <Badge variant="secondary" className="text-xs">
                          {emailData.actionTaken.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      <div>From: {parsedMessage.from.name ? `${parsedMessage.from.name} <${parsedMessage.from.address}>` : parsedMessage.from.address}</div>
                      <div>To: {parsedMessage.to.map(addr =>
                        addr.name ? `${addr.name} <${addr.address}>` : addr.address
                      ).join(', ')}</div>
                      {parsedMessage.cc && parsedMessage.cc.length > 0 && (
                        <div>CC: {parsedMessage.cc.map(addr =>
                          addr.name ? `${addr.name} <${addr.address}>` : addr.address
                        ).join(', ')}</div>
                      )}
                      <div>Date: {new Date(parsedMessage.date).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {/* Headers section */}
                <details className="mb-4">
                  <summary className="cursor-pointer text-sm font-medium mb-2">
                    Email Headers ({parsedMessage.headers.length})
                  </summary>
                  <div className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto">
                    {parsedMessage.headers.map((header, idx) => (
                      <div key={idx} className="mb-1">
                        <span className="font-semibold">{header.key}:</span> {header.value}
                      </div>
                    ))}
                  </div>
                </details>

                <Separator className="my-4" />

                {/* Attachments */}
                {parsedMessage.attachments.length > 0 && (
                  <>
                    <div className="mb-4">
                      <h3 className="text-sm font-medium mb-2 flex items-center">
                        <Paperclip className="mr-2 h-4 w-4" />
                        Attachments ({parsedMessage.attachments.length})
                      </h3>
                      <div className="space-y-2">
                        {parsedMessage.attachments.map((attachment, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm flex-1">{attachment.filename || 'Unnamed'}</span>
                            <span className="text-xs text-muted-foreground">
                              {attachment.mimeType}
                              {attachment.content && typeof attachment.content !== 'string' &&
                                ` • ${formatFileSize(attachment.content.byteLength)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator className="my-4" />
                  </>
                )}

                {/* Email body */}
                <div className="prose prose-sm max-w-none">
                  {parsedMessage.html ? (
                    <div className="email-content-wrapper" style={{ textAlign: 'left' }}>
                      <div
                        className="email-content"
                        dangerouslySetInnerHTML={{ __html: parsedMessage.html }}
                      />
                    </div>
                  ) : parsedMessage.text ? (
                    <pre className="whitespace-pre-wrap font-sans">{parsedMessage.text}</pre>
                  ) : (
                    <p className="text-muted-foreground">No content available</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>Failed to load email</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analysis">
          {generatedDraft ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Analysis</CardTitle>
                <div className="text-sm text-muted-foreground mt-1">
                  <div>To: {generatedDraft.to}</div>
                  {generatedDraft.cc && <div>CC: {generatedDraft.cc}</div>}
                  <div>Subject: {generatedDraft.subject}</div>
                  <div>Relationship: {generatedDraft.relationship.type} ({Math.round(generatedDraft.relationship.confidence * 100)}% confidence)</div>
                </div>
              </CardHeader>
              <CardContent>
                {generatedDraft.body ? (
                  <div className="bg-muted p-4 rounded-md">
                    <pre className="whitespace-pre-wrap font-sans text-sm">{generatedDraft.body}</pre>
                  </div>
                ) : (
                  <div className="bg-muted p-4 rounded-md text-center text-muted-foreground">
                    <p className="text-sm">No draft body - email was filed automatically</p>
                  </div>
                )}

                {/* AI Analysis Metadata */}
                {generatedDraft.meta && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-muted-foreground" />
                        <h3 className="font-semibold">AI Analysis</h3>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        Message ID: {generatedDraft.inReplyTo}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left Column */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">Spam Analysis</div>
                          {
                            generatedDraft.draftMetadata.spamAnalysis.isSpam ? (
                              <Badge
                                variant="destructive"
                                className="cursor-help"
                                title={generatedDraft.draftMetadata.spamAnalysis.indicators.join('\n')}
                              >
                                ⚠️ Spam
                                {generatedDraft.draftMetadata.spamAnalysis.senderResponseCount > 0 && (
                                  <span className="ml-1">
                                    (replied {generatedDraft.draftMetadata.spamAnalysis.senderResponseCount}x)
                                  </span>
                                )}
                              </Badge>
                            ) : (
                              <Badge
                                variant="default"
                                className="cursor-help"
                                title={generatedDraft.draftMetadata.spamAnalysis.indicators.join('\n')}
                              >
                                ✓ Not Spam
                                {generatedDraft.draftMetadata.spamAnalysis.senderResponseCount > 0 && (
                                  <span className="ml-1">
                                    (replied {generatedDraft.draftMetadata.spamAnalysis.senderResponseCount}x)
                                  </span>
                                )}
                              </Badge>
                            )
                          }
                        </div>

                        <div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">Recommended Action</div>
                          <Badge
                            variant={
                              generatedDraft.meta.recommendedAction === EmailActions.SILENT_AMBIGUOUS ? 'destructive' :
                              generatedDraft.meta.recommendedAction.startsWith('silent') ? 'secondary' :
                              generatedDraft.meta.recommendedAction.includes('forward') ? 'outline' : 'default'
                            }
                            className={
                              generatedDraft.meta.recommendedAction === EmailActions.SILENT_AMBIGUOUS
                                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                                : ''
                            }
                          >
                            {generatedDraft.meta.recommendedAction === EmailActions.SILENT_AMBIGUOUS && '⚠️ '}
                            {generatedDraft.meta.recommendedAction}
                          </Badge>
                        </div>
                      </div>

                      {/* Right Column */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">Context Flags</div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={generatedDraft.meta.contextFlags.isThreaded ? "default" : "outline"} className="text-xs">
                              {generatedDraft.meta.contextFlags.isThreaded ? "✓" : "✗"} Threaded
                            </Badge>
                            <Badge variant={generatedDraft.meta.contextFlags.hasAttachments ? "default" : "outline"} className="text-xs">
                              {generatedDraft.meta.contextFlags.hasAttachments ? "✓" : "✗"} Has Attachments
                            </Badge>
                            <Badge variant={generatedDraft.meta.contextFlags.isGroupEmail ? "default" : "outline"} className="text-xs">
                              {generatedDraft.meta.contextFlags.isGroupEmail ? "✓" : "✗"} Group Email
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              Addressed To: {generatedDraft.meta.contextFlags.inboundMsgAddressedTo}
                            </Badge>
                            <Badge variant={
                              generatedDraft.meta.contextFlags.urgencyLevel === 'critical' ? 'destructive' :
                              generatedDraft.meta.contextFlags.urgencyLevel === 'high' ? 'default' :
                              'secondary'
                            } className="text-xs">
                              Urgency: {generatedDraft.meta.contextFlags.urgencyLevel}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Key Considerations */}
                    {Array.isArray(generatedDraft.meta?.keyConsiderations) && generatedDraft.meta.keyConsiderations.length > 0 && (
                      <div className="mt-4">
                        <div className="text-sm font-medium text-muted-foreground mb-2">Key Considerations</div>
                        <ul className="list-disc list-inside space-y-1">
                          {generatedDraft.meta.keyConsiderations.map((consideration, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground">{consideration}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>No draft available for this email</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Add some basic email content styling */}
      <style jsx global>{`
        .email-content-wrapper {
          text-align: left !important;
          display: block !important;
          isolation: isolate;
        }
        .email-content * {
          all: revert;
        }
        .email-content img {
          max-width: 100%;
          height: auto;
        }
        .email-content a {
          color: #6366f1;
          text-decoration: underline;
        }
        .email-content center,
        .email-content [align="center"] {
          text-align: center;
        }
      `}</style>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6 max-w-6xl"><div className="text-center py-12">Loading...</div></div>}>
      <InboxContent />
    </Suspense>
  );
}
