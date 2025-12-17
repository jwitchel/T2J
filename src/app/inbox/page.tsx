'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Paperclip, FileText, Brain, AlertCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import PostalMime from 'postal-mime'
import { apiGet } from '@/lib/api'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSearchParams } from 'next/navigation'
import { EmailActionType } from '../../../server/src/types/email-action-tracking'
import type { SpamCheckResult } from '../../../server/src/lib/pipeline/types'
import { RelationshipSelector } from '@/components/relationship-selector'
import { PageHeader } from '@/components/patterns'

interface ParsedEmail {
  headers: Array<{ key: string; value: string }>
  from: { name?: string; address: string }
  to: Array<{ name?: string; address: string }>
  cc?: Array<{ name?: string; address: string }>
  subject: string
  date: Date
  text?: string
  html?: string
  attachments: Array<{
    filename: string | null
    mimeType: string
    disposition: 'attachment' | 'inline' | null
    related?: boolean
    description?: string
    contentId?: string
    method?: string
    content: ArrayBuffer | string
    encoding?: 'base64' | 'utf8'
  }>
}

interface EmailData {
  messageId: string
  subject: string
  from: string
  fromName?: string
  to: string[]
  cc?: string[]
  date: string
  rawMessage: string
  uid?: number
  flags: string[]
  size: number
  actionTaken?: EmailActionType
}

// Shadow DOM component to isolate email HTML styles from the rest of the page
function IsolatedEmailContent({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Clear any existing shadow root content
    const existing = containerRef.current.shadowRoot
    if (existing) {
      existing.innerHTML = ''
    }

    // Create shadow root if it doesn't exist
    const shadowRoot = existing || containerRef.current.attachShadow({ mode: 'open' })

    // Add base styles for the shadow DOM content
    const styles = `
      <style>
        :host {
          display: block;
          text-align: left;
        }
        * {
          font-family: ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
        }
        img {
          max-width: 100%;
          height: auto;
        }
        a {
          color: #6366f1;
          text-decoration: underline;
        }
        table {
          border-collapse: collapse;
          max-width: 100%;
        }
      </style>
    `

    shadowRoot.innerHTML = styles + html
  }, [html])

  return <div ref={containerRef} className="email-shadow-container" />
}

function InboxContent() {
  const { error } = useToast()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('analysis')
  const [emailData, setEmailData] = useState<EmailData | null>(null)
  const [parsedMessage, setParsedMessage] = useState<ParsedEmail | null>(null)
  const [llmResponse, setLlmResponse] = useState<{
    meta: {
      recommendedAction: EmailActionType
      keyConsiderations: string[]
      contextFlags: {
        isThreaded: boolean
        hasAttachments: boolean
        isGroupEmail: boolean
        inboundMsgAddressedTo: 'you' | 'group' | 'someone-else'
        urgencyLevel: 'low' | 'medium' | 'high' | 'critical'
      }
    }
    generatedAt: string
    providerId: string
    modelName: string
    draftId: string
    body?: string
    bodyHtml?: string
    relationship: {
      type: string
      confidence: number
    }
    spamAnalysis: SpamCheckResult
  } | null>(null)

  // URL parameters (required)
  const emailAccountId = searchParams.get('emailAccountId')
  const messageId = searchParams.get('messageId')

  // Fetch email when URL parameters are available
  useEffect(() => {
    if (emailAccountId && messageId) {
      fetchEmail(emailAccountId, messageId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailAccountId, messageId])

  // Parse email when raw message changes
  useEffect(() => {
    if (emailData?.rawMessage) {
      parseMessage(emailData.rawMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailData])

  const fetchEmail = async (accountId: string, msgId: string) => {
    setLoading(true)
    try {
      const data = await apiGet<{
        success: boolean
        email: {
          messageId: string
          subject: string
          from: string
          fromName?: string
          to: string[]
          cc?: string[]
          date: string
          rawMessage: string
          uid?: number
          flags: string[]
          size: number
          actionTaken?: EmailActionType
          llmResponse?: {
            meta: {
              recommendedAction: EmailActionType
              keyConsiderations: string[]
              contextFlags: {
                isThreaded: boolean
                hasAttachments: boolean
                isGroupEmail: boolean
                inboundMsgAddressedTo: 'you' | 'group' | 'someone-else'
                urgencyLevel: 'low' | 'medium' | 'high' | 'critical'
              }
            }
            generatedAt: string
            providerId: string
            modelName: string
            draftId: string
            body?: string
            bodyHtml?: string
            relationship: {
              type: string
              confidence: number
            }
            spamAnalysis: SpamCheckResult
          }
        }
      }>(`/api/inbox/email/${accountId}/${encodeURIComponent(msgId)}`)

      if (data.success && data.email) {
        setEmailData(data.email)
        setLlmResponse(data.email.llmResponse || null)
        console.log('Email data loaded:', {
          hasLlmResponse: !!data.email.llmResponse,
          email: data.email,
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load email'
      error(errorMessage)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const parseMessage = async (rawMessage: string) => {
    try {
      const parser = new PostalMime()
      const parsed = await parser.parse(rawMessage)

      // Convert headers to array format
      const headersArray: Array<{ key: string; value: string }> = []

      if (Array.isArray(parsed.headers)) {
        parsed.headers.forEach((header: unknown) => {
          if (header && typeof header === 'object' && 'key' in header && 'value' in header) {
            const headerValue = Array.isArray(header.value)
              ? header.value.join(', ')
              : String(header.value)
            headersArray.push({ key: String(header.key), value: headerValue })
          }
        })
      } else if (parsed.headers && typeof parsed.headers === 'object') {
        Object.entries(parsed.headers).forEach(([key, value]) => {
          const headerValue = Array.isArray(value) ? value.join(', ') : String(value)
          headersArray.push({ key, value: headerValue })
        })
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
      })
    } catch (err) {
      console.error('Failed to parse message:', err)
      error('Failed to parse email message')
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // Show error if URL parameters are missing
  if (!emailAccountId || !messageId) {
    return (
      <div className="container mx-auto max-w-6xl p-6">
        <Alert
          variant="destructive"
          className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
        >
          <AlertCircle />
          <AlertTitle>Missing Parameters</AlertTitle>
          <AlertDescription>
            This page requires email account ID and message ID parameters.
            <Link href="/dashboard">
              <Button size="sm" variant="outline" className="mt-2">
                Go to Dashboard
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <PageHeader title="Message Analysis" />

      {/* Email display with tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="message">Message</TabsTrigger>
        </TabsList>

        <TabsContent value="message">
          {loading ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="mb-2 h-4 w-full" />
                <Skeleton className="mb-2 h-4 w-full" />
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ) : emailData && parsedMessage ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">
                        {parsedMessage.subject || '(No subject)'}
                      </CardTitle>
                      {emailData.actionTaken &&
                        emailData.actionTaken !== EmailActionType.PENDING && (
                          <Badge
                            variant="secondary"
                            className="text-xs"
                            style={{
                              backgroundColor: EmailActionType.COLORS[emailData.actionTaken],
                              color: 'white',
                            }}
                          >
                            {EmailActionType.LABELS[emailData.actionTaken]}
                          </Badge>
                        )}
                    </div>
                    <div className="text-muted-foreground mt-1 text-sm">
                      <div>
                        From:{' '}
                        {parsedMessage.from.name
                          ? `${parsedMessage.from.name} <${parsedMessage.from.address}>`
                          : parsedMessage.from.address}
                      </div>
                      <div>
                        To:{' '}
                        {parsedMessage.to
                          .map((addr) =>
                            addr.name ? `${addr.name} <${addr.address}>` : addr.address
                          )
                          .join(', ')}
                      </div>
                      {parsedMessage.cc && parsedMessage.cc.length > 0 && (
                        <div>
                          CC:{' '}
                          {parsedMessage.cc
                            .map((addr) =>
                              addr.name ? `${addr.name} <${addr.address}>` : addr.address
                            )
                            .join(', ')}
                        </div>
                      )}
                      <div>Date: {new Date(parsedMessage.date).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {/* Headers section */}
                <details className="mb-4">
                  <summary className="mb-2 cursor-pointer text-sm font-medium">
                    Email Headers ({parsedMessage.headers.length})
                  </summary>
                  <div className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
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
                      <h3 className="mb-2 flex items-center text-sm font-medium">
                        <Paperclip className="mr-2 h-4 w-4" />
                        Attachments ({parsedMessage.attachments.length})
                      </h3>
                      <div className="space-y-2">
                        {parsedMessage.attachments.map((attachment, idx) => (
                          <div
                            key={idx}
                            className="bg-muted flex items-center gap-2 rounded-md p-2"
                          >
                            <FileText className="text-muted-foreground h-4 w-4" />
                            <span className="flex-1 text-sm">
                              {attachment.filename || 'Unnamed'}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {attachment.mimeType}
                              {attachment.content &&
                                typeof attachment.content !== 'string' &&
                                ` • ${formatFileSize(attachment.content.byteLength)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator className="my-4" />
                  </>
                )}

                {/* Email body - Shadow DOM isolates email styles from page */}
                <div className="prose prose-sm max-w-none">
                  {parsedMessage.html ? (
                    <IsolatedEmailContent html={parsedMessage.html} />
                  ) : parsedMessage.text ? (
                    <pre className="font-sans whitespace-pre-wrap">{parsedMessage.text}</pre>
                  ) : (
                    <p className="text-muted-foreground">No content available</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center">
                <p>Failed to load email</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analysis">
          {llmResponse && emailData ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Analysis</CardTitle>
                <div className="text-muted-foreground mt-1 text-sm">
                  <div>To: {emailData.to.join(', ')}</div>
                  {emailData.cc && emailData.cc.length > 0 && (
                    <div>CC: {emailData.cc.join(', ')}</div>
                  )}
                  <div>Subject: {emailData.subject}</div>
                  <div className="flex items-center gap-2">
                    <span>Relationship:</span>
                    <RelationshipSelector
                      emailAddress={emailData.from}
                      currentRelationship={llmResponse.relationship.type}
                    />
                    <span className="text-xs">
                      ({Math.round(llmResponse.relationship.confidence * 100)}% confidence)
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {llmResponse.body ? (
                  <div className="bg-muted rounded-md p-4">
                    <pre className="font-sans text-sm whitespace-pre-wrap">{llmResponse.body}</pre>
                  </div>
                ) : (
                  <div className="bg-muted text-muted-foreground rounded-md p-4 text-center">
                    <p className="text-sm">No draft body - email was filed automatically</p>
                  </div>
                )}

                {/* AI Analysis Metadata */}
                {llmResponse.meta && (
                  <div className="mt-6">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Brain className="text-muted-foreground h-5 w-5" />
                        <h3 className="font-semibold">AI Analysis</h3>
                      </div>
                      <div className="text-muted-foreground font-mono text-xs">
                        Message ID: {emailData.messageId}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {/* Left Column */}
                      <div className="space-y-3">
                        {llmResponse.spamAnalysis && (
                          <div>
                            <div className="text-muted-foreground mb-1 text-sm font-medium">
                              Spam Analysis
                            </div>
                            {llmResponse.spamAnalysis.isSpam ? (
                              <Badge
                                variant="destructive"
                                className="cursor-help"
                                title={llmResponse.spamAnalysis.indicators.join('\n')}
                              >
                                ⚠️ Spam
                                {llmResponse.spamAnalysis.senderResponseCount > 0 && (
                                  <span className="ml-1">
                                    (replied {llmResponse.spamAnalysis.senderResponseCount}x)
                                  </span>
                                )}
                              </Badge>
                            ) : (
                              <Badge
                                variant="default"
                                className="cursor-help"
                                title={llmResponse.spamAnalysis.indicators.join('\n')}
                              >
                                ✓ Not Spam
                                {llmResponse.spamAnalysis.senderResponseCount > 0 && (
                                  <span className="ml-1">
                                    (replied {llmResponse.spamAnalysis.senderResponseCount}x)
                                  </span>
                                )}
                              </Badge>
                            )}
                          </div>
                        )}

                        <div>
                          <div className="text-muted-foreground mb-1 text-sm font-medium">
                            Recommended Action
                          </div>
                          <Badge
                            variant="secondary"
                            style={{
                              backgroundColor:
                                EmailActionType.COLORS[llmResponse.meta.recommendedAction],
                              color: 'white',
                            }}
                          >
                            {EmailActionType.LABELS[llmResponse.meta.recommendedAction]}
                          </Badge>
                        </div>
                      </div>

                      {/* Right Column */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-muted-foreground mb-1 text-sm font-medium">
                            Context Flags
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge
                              variant={
                                llmResponse.meta.contextFlags.isThreaded ? 'default' : 'outline'
                              }
                              className="text-xs"
                            >
                              {llmResponse.meta.contextFlags.isThreaded ? '✓' : '✗'} Threaded
                            </Badge>
                            <Badge
                              variant={
                                llmResponse.meta.contextFlags.hasAttachments ? 'default' : 'outline'
                              }
                              className="text-xs"
                            >
                              {llmResponse.meta.contextFlags.hasAttachments ? '✓' : '✗'} Has
                              Attachments
                            </Badge>
                            <Badge
                              variant={
                                llmResponse.meta.contextFlags.isGroupEmail ? 'default' : 'outline'
                              }
                              className="text-xs"
                            >
                              {llmResponse.meta.contextFlags.isGroupEmail ? '✓' : '✗'} Group Email
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              Addressed To: {llmResponse.meta.contextFlags.inboundMsgAddressedTo}
                            </Badge>
                            <Badge
                              variant={
                                llmResponse.meta.contextFlags.urgencyLevel === 'critical'
                                  ? 'destructive'
                                  : llmResponse.meta.contextFlags.urgencyLevel === 'high'
                                    ? 'default'
                                    : 'secondary'
                              }
                              className="text-xs"
                            >
                              Urgency: {llmResponse.meta.contextFlags.urgencyLevel}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Key Considerations */}
                    {Array.isArray(llmResponse.meta?.keyConsiderations) &&
                      llmResponse.meta.keyConsiderations.length > 0 && (
                        <div className="mt-4">
                          <div className="text-muted-foreground mb-2 text-sm font-medium">
                            Key Considerations
                          </div>
                          <ul className="list-inside list-disc space-y-1">
                            {llmResponse.meta.keyConsiderations.map((consideration, idx) => (
                              <li key={idx} className="text-muted-foreground text-sm">
                                {consideration}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : loading ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center">
                <p>Loading analysis...</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center">
                <p>No analysis available for this email</p>
                {emailData?.actionTaken && (
                  <p className="mt-2 text-sm">
                    Action taken: {EmailActionType.LABELS[emailData.actionTaken]}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

    </div>
  )
}

export default function InboxPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-6xl p-6">
          <div className="py-12 text-center">Loading...</div>
        </div>
      }
    >
      <InboxContent />
    </Suspense>
  )
}
