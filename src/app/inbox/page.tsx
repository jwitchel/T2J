'use client';

import { useState, useEffect, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, Mail, Paperclip, FileText, Send, Loader2, Brain, AlertCircle, FolderOpen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PostalMime from 'postal-mime';
import { apiGet, apiPost } from '@/lib/api';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSearchParams } from 'next/navigation';
import { EmailActions, RecommendedAction } from '../../../server/src/lib/email-actions';
import type { SpamCheckResult } from '../../../server/src/lib/pipeline/types';
import type { EmailActionType } from '../../../server/src/types/email-action-tracking';

interface EmailAccount {
  id: string;
  email: string;
  host: string;
}

interface EmailMessage {
  uid: number;
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  date: Date;
  flags: string[];
  size: number;
  rawMessage: string;
  actionTaken?: EmailActionType;
  updatedAt?: Date;  // When the action was taken
}

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

function InboxContent() {
  const { error, success } = useToast();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [currentMessage, setCurrentMessage] = useState<EmailMessage | null>(null);
  const [parsedMessage, setParsedMessage] = useState<ParsedEmail | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('message');
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedDraft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploadingDraft, setIsUploadingDraft] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [userFolderPrefs, setUserFolderPrefs] = useState<{
    rootFolder?: string;
    noActionFolder?: string;
    spamFolder?: string;
    todoFolder?: string;
  } | null>(null);
  const [draftsFolderPath, setDraftsFolderPath] = useState<string | null>(null);
  const [jumpToInput, setJumpToInput] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [showAllEmails, setShowAllEmails] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // URL parameter mode: viewing a specific email from database
  const urlEmailAccountId = searchParams.get('emailAccountId');
  const urlMessageId = searchParams.get('messageId');
  const isViewMode = !!(urlEmailAccountId && urlMessageId);

  const selectedAccountEmail = accounts.find(a => a.id === selectedAccount)?.email;
  
  // Helper function to get destination folder based on recommended action
  const getDestinationFolder = (recommendedAction?: string) => {
    const rootPath = userFolderPrefs?.rootFolder ? `${userFolderPrefs.rootFolder}/` : '';

    switch (recommendedAction) {
      case EmailActions.REPLY:
      case EmailActions.REPLY_ALL:
      case EmailActions.FORWARD:
      case EmailActions.FORWARD_WITH_COMMENT:
        return {
          folder: draftsFolderPath!,
          displayName: draftsFolderPath!,
          buttonLabel: 'Send to Drafts',
          error: false
        };

      case EmailActions.SILENT_FYI_ONLY:
      case EmailActions.SILENT_LARGE_LIST:
      case EmailActions.SILENT_UNSUBSCRIBE:
        return {
          folder: `${rootPath}${userFolderPrefs!.noActionFolder}`,
          displayName: userFolderPrefs!.noActionFolder!,
          buttonLabel: 'File as No Action',
          error: false
        };

      case EmailActions.SILENT_SPAM:
        return {
          folder: `${rootPath}${userFolderPrefs!.spamFolder}`,
          displayName: userFolderPrefs!.spamFolder!,
          buttonLabel: 'Move to Spam',
          error: false
        };

      case EmailActions.SILENT_TODO:
        return {
          folder: `${rootPath}${userFolderPrefs!.todoFolder}`,
          displayName: userFolderPrefs!.todoFolder!,
          buttonLabel: 'Move to Todo',
          error: false
        };

      case EmailActions.SILENT_AMBIGUOUS:
        return {
          folder: 'INBOX',
          displayName: 'INBOX (Requires Manual Review)',
          buttonLabel: 'Mark as Reviewed',
          error: false,
          isAmbiguous: true
        };

      default:
        return {
          folder: '[Unknown action]',
          displayName: '[Unknown]',
          buttonLabel: 'Unknown Action',
          error: true
        };
    }
  };
  
  // Fetch email accounts on mount
  useEffect(() => {
    fetchAccounts();
    fetchProviders();
    fetchUserPreferences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch specific email from URL parameters (view mode)
  useEffect(() => {
    if (isViewMode && urlEmailAccountId && urlMessageId) {
      fetchSpecificEmail(urlEmailAccountId, urlMessageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewMode, urlEmailAccountId, urlMessageId]);

  // Fetch message when account or index changes (normal pagination mode)
  useEffect(() => {
    if (selectedAccount && !isViewMode) {
      // Clear reauth flag when switching accounts
      setNeedsReauth(false);
      fetchMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, currentIndex, showAllEmails, isViewMode]);

  // Parse message when raw message changes
  useEffect(() => {
    if (currentMessage?.rawMessage) {
      parseMessage(currentMessage.rawMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMessage]);
  
  const fetchAccounts = async () => {
    try {
      const data = await apiGet<{ accounts: EmailAccount[] }>('/api/inbox/accounts');
      setAccounts(data.accounts);
    } catch (err) {
      error('Failed to load email accounts');
      console.error(err);
    }
  };
  
  const fetchMessage = async () => {
    if (!selectedAccount) return;

    setLoading(true);
    try {
      const data = await apiGet<{
        messages: EmailMessage[];
        total: number;
        offset: number;
        limit: number;
      }>(`/api/inbox/emails/${selectedAccount}?offset=${currentIndex}&limit=1&showAll=${showAllEmails}`);

      if (data.messages.length > 0) {
        setCurrentMessage(data.messages[0]);
        // Handle unknown total (-1) by not updating or using a high number
        if (data.total >= 0) {
          setTotalMessages(data.total);
        }
      } else {
        setCurrentMessage(null);
        setParsedMessage(null);
        setTotalMessages(0);
      }
    } catch (err) {
      const errWithCode = err as Error & { code?: string };
      if (errWithCode.code === 'OAUTH_REAUTH_REQUIRED' || errWithCode.code === 'INVALID_CREDENTIALS') {
        setNeedsReauth(true);
        error(`Email account credentials are invalid. Please reconnect your account in Settings.`);
      } else {
        error('Failed to load message');
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch a specific email from database by messageId (view mode)
  const fetchSpecificEmail = async (accountId: string, messageId: string) => {
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
          relationship: {
            type: string;
            confidence: number;
          };
        };
      }>(`/api/inbox/email/${accountId}/${encodeURIComponent(messageId)}`);

      if (data.success && data.email) {
        // Convert the email data to the EmailMessage format
        const emailMessage: EmailMessage = {
          uid: data.email.uid || 0,
          messageId: data.email.messageId,
          from: data.email.from,
          to: data.email.to,
          subject: data.email.subject,
          date: new Date(data.email.date),
          flags: data.email.flags,
          size: data.email.size,
          rawMessage: data.email.rawMessage,
          actionTaken: data.email.actionTaken // Must exist - backend validates
        };

        setCurrentMessage(emailMessage);
        setSelectedAccount(accountId);

        // If llmResponse exists, convert it to GeneratedDraft format
        if (data.email.llmResponse) {
          const draft: GeneratedDraft = {
            id: data.email.llmResponse.draftId,
            from: '', // Not stored in llmResponse
            to: data.email.to.join(', '),
            cc: data.email.cc?.join(', ') || '',
            subject: data.email.subject,
            body: data.email.llmResponse.body || '',
            bodyHtml: data.email.llmResponse.bodyHtml,
            inReplyTo: data.email.messageId,
            references: data.email.messageId,
            meta: data.email.llmResponse.meta,
            relationship: data.email.llmResponse.relationship || data.email.relationship,
            draftMetadata: {
              originalSubject: data.email.subject,
              originalFrom: data.email.from,
              spamAnalysis: data.email.llmResponse.spamAnalysis,
              exampleCount: 0, // Not stored in llmResponse
              timestamp: data.email.llmResponse.generatedAt
            }
          };

          setGeneratedDraft(draft);
          setActiveTab('response'); // Switch to response tab to show analysis
        }
      }
    } catch (err) {
      // Check if the error has a message field with more details
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to load email from history';
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
      
      // postal-mime returns headers as an array of {key, value} objects
      if (Array.isArray(parsed.headers)) {
        parsed.headers.forEach((header: unknown) => {
          if (header && typeof header === 'object' && 'key' in header && 'value' in header) {
            const headerValue = Array.isArray(header.value) ? header.value.join(', ') : String(header.value);
            headersArray.push({ key: String(header.key), value: headerValue });
          }
        });
      } else if (parsed.headers && typeof parsed.headers === 'object') {
        // If headers is a Map or object
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
  
  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setActiveTab('message');
    }
  };
  
  const handleNext = () => {
    if (currentIndex < totalMessages - 1) {
      setCurrentIndex(currentIndex + 1);
      setActiveTab('message');
    }
  };
  
  const fetchUserPreferences = async () => {
    try {
      const data = await apiGet<{ preferences: { folderPreferences?: {
        rootFolder?: string;
        noActionFolder?: string;
        spamFolder?: string;
        todoFolder?: string;
        draftsFolderPath?: string;
      } } }>('/api/settings/profile');

      if (data.preferences?.folderPreferences) {
        const { draftsFolderPath, ...otherPrefs } = data.preferences.folderPreferences;

        // Use default [Gmail]/Drafts if not configured (matches backend fallback)
        // No validation needed - backend handles fallback gracefully
        setConfigError(null);

        setUserFolderPrefs(otherPrefs);
        setDraftsFolderPath(draftsFolderPath || '[Gmail]/Drafts');
      } else {
        // Should never happen - backend always returns defaults
        setConfigError('Folder preferences not configured. Please refresh the page.');
      }
    } catch (err) {
      console.error('Failed to load folder preferences:', err);
      setConfigError('Failed to load folder configuration. Please refresh the page.');
    }
  };
  
  const fetchProviders = async () => {
    try {
      const providers = await apiGet<Array<{ 
        id: string; 
        provider_name: string; 
        provider_type: string;
        model_name: string;
        is_active: boolean;
        is_default: boolean;
      }>>('/api/llm-providers');
      
      const activeProviders = providers
        .filter(p => p.is_active)
        .map(p => ({ id: p.id, name: p.provider_name }));
        
      setProviders(activeProviders);
      
      // Select default provider or first active one
      const defaultProvider = providers.find(p => p.is_default && p.is_active);
      if (defaultProvider) {
        setSelectedProviderId(defaultProvider.id);
      } else if (activeProviders.length > 0) {
        setSelectedProviderId(activeProviders[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    }
  };
  
  const handleGenerateDraft = async () => {
    if (!currentMessage || !selectedAccount || !selectedProviderId) {
      error('Missing required information for draft generation');
      return;
    }
    
    setIsGenerating(true);
    setGeneratedDraft(null);
    
    try {
      const data = await apiPost<{ success: boolean; draft: GeneratedDraft }>('/api/inbox-draft/generate-draft', {
        rawMessage: currentMessage.rawMessage,
        emailAccountId: selectedAccount,
        providerId: selectedProviderId
      });
      
      if (data.success && data.draft) {
        setGeneratedDraft(data.draft);
        setActiveTab('response');
        success('Draft generated successfully!');
      }
    } catch (err) {
      error('Failed to generate draft');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleSendToDraft = async () => {
    if (!generatedDraft || !selectedAccount || !currentMessage) {
      error('No draft to send');
      return;
    }

    setIsUploadingDraft(true);

    try {
      // Use the consolidated process-single endpoint
      // Pass the already-generated draft to avoid LLM non-determinism
      const res = await apiPost<{ success: boolean; folder: string; message: string; action?: string; draftId?: string }>(
        '/api/inbox/process-single',
        {
          emailAccountId: selectedAccount,
          messageUid: currentMessage.uid,
          messageId: currentMessage.messageId,
          messageSubject: currentMessage.subject,
          messageFrom: currentMessage.from,
          rawMessage: currentMessage.rawMessage,
          providerId: selectedProviderId,
          generatedDraft: generatedDraft // Pass the existing draft to avoid regenerating
        }
      );

      if (res.folder) {
        success(`Email sent to ${res.folder}!`);
      } else {
        success(res.message || 'Email processed successfully');
      }
    } catch (err) {
      console.error('Failed to process email:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to process email';
      error(errorMessage);
    } finally {
      setIsUploadingDraft(false);
    }
  };
  
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  
  const handleForceEvaluation = async () => {
    if (!currentMessage || !selectedAccount) return;
    
    try {
      await apiPost(`/api/inbox/emails/${selectedAccount}/reset-action`, {
        messageId: currentMessage.messageId
      });
      success('Email marked for re-evaluation');
      // Refresh the current message to update the UI
      await fetchMessage();
    } catch (err) {
      console.error('Failed to reset email action:', err);
      error('Failed to reset email action');
    }
  };
  
  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {needsReauth && (
        <div className="mb-4">
          <Alert className="py-2 border-amber-300 bg-amber-50 dark:bg-amber-950">
            <AlertDescription className="flex items-center justify-between">
              <span className="text-xs">
                {selectedAccountEmail
                  ? (<span><strong>{selectedAccountEmail}</strong> requires re-authorization. Please reconnect to continue.</span>)
                  : 'This email account requires re-authorization. Please reconnect to continue.'}
              </span>
              <Link href={`/settings/email-accounts?reauth=${encodeURIComponent(selectedAccount)}`}>
                <Button size="sm">Reconnect</Button>
              </Link>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {configError && (
        <Alert variant="destructive" className="mb-4 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
          <AlertCircle />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            {configError}
            <Link href="/settings">
              <Button size="sm" variant="outline" className="mt-2">Go to Settings</Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">
          Inbox {isViewMode && <span className="text-sm font-normal text-muted-foreground">(Viewing from History)</span>}
        </h1>

        {/* Show pagination controls only when NOT in view mode */}
        {!isViewMode && (
          <>
            {/* Account selector */}
            <div className="flex items-center gap-2 mb-4">
              <Select value={selectedAccount} onValueChange={(value) => {
                if (value) {
                  setSelectedAccount(value);
                  setCurrentIndex(0); // Reset to first message when switching accounts
                }
              }}>
                <SelectTrigger className="w-[240px] h-7 text-xs">
                  <SelectValue placeholder="Select Email Account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Email filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Show:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="radio"
                    id="unprocessedOnly"
                    name="emailFilter"
                    checked={!showAllEmails}
                    onChange={() => {
                      setShowAllEmails(false);
                      setCurrentIndex(0);
                    }}
                    className="h-3 w-3"
                  />
                  <label htmlFor="unprocessedOnly" className="text-xs">
                    Unprocessed Only
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="radio"
                    id="allEmails"
                    name="emailFilter"
                    checked={showAllEmails}
                    onChange={() => {
                      setShowAllEmails(true);
                      setCurrentIndex(0);
                    }}
                    className="h-3 w-3"
                  />
                  <label htmlFor="allEmails" className="text-xs">
                    All Emails
                  </label>
                </div>
              </div>
          
          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={handlePrevious}
              disabled={currentIndex === 0 || loading}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>

            <span className="text-xs text-muted-foreground px-2">
              {totalMessages > 0 ? `${currentIndex + 1} of ${totalMessages}` : '0 messages'}
            </span>

            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={handleNext}
              disabled={currentIndex >= totalMessages - 1 || loading}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>

            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-muted-foreground">Jump to:</span>
              <Input
                type="number"
                min="1"
                max={totalMessages}
                value={jumpToInput}
                onChange={(e) => setJumpToInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const index = parseInt(jumpToInput) - 1;
                    if (!isNaN(index) && index >= 0 && index < totalMessages) {
                      setCurrentIndex(index);
                      setActiveTab('message');
                      setJumpToInput('');
                    } else {
                      error(`Please enter a number between 1 and ${totalMessages}`);
                    }
                  }
                }}
                className="w-16 h-7 text-xs"
                placeholder="#"
              />
              <Button
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const index = parseInt(jumpToInput) - 1;
                  if (!isNaN(index) && index >= 0 && index < totalMessages) {
                    setCurrentIndex(index);
                    setActiveTab('message');
                    setJumpToInput('');
                  } else {
                    error(`Please enter a number between 1 and ${totalMessages}`);
                  }
                }}
                disabled={!jumpToInput || loading}
              >
                Go
              </Button>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
      
      {/* Email display with tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="message">Message</TabsTrigger>
          <TabsTrigger value="response" disabled={!generatedDraft}>
            Response {generatedDraft && <span className="ml-1 text-xs">(Ready)</span>}
          </TabsTrigger>
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
          ) : currentMessage && parsedMessage ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{parsedMessage.subject || '(No subject)'}</CardTitle>
                  {currentMessage.actionTaken && currentMessage.actionTaken !== 'none' && (
                    <Badge variant="secondary" className="text-xs">
                      {currentMessage.actionTaken.replace('_', ' ')}
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
              {!isViewMode && (
                <div className="flex items-center gap-2">
                  {providers.length > 0 && (
                    <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map(provider => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {currentMessage.actionTaken && currentMessage.actionTaken !== 'none' && (
                    <Button
                      onClick={handleForceEvaluation}
                      variant="outline"
                      size="sm"
                      title="Reset action taken and allow re-evaluation"
                    >
                      Force Evaluation
                    </Button>
                  )}
                  <Button
                    onClick={handleGenerateDraft}
                    disabled={isGenerating || !selectedProviderId}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Generate Draft
                      </>
                    )}
                  </Button>
                </div>
              )}
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
                <div 
                  className="email-content"
                  dangerouslySetInnerHTML={{ __html: parsedMessage.html }}
                />
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
                {accounts.length === 0 ? (
                  <p>No email accounts configured. Please add an email account first.</p>
                ) : (
                  <p>Select an email account to view messages</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        <TabsContent value="response">
          {generatedDraft ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">Draft Reply</CardTitle>
                    <div className="text-sm text-muted-foreground mt-1">
                      <div>To: {generatedDraft.to}</div>
                      {generatedDraft.cc && <div>CC: {generatedDraft.cc}</div>}
                      <div>Subject: {generatedDraft.subject}</div>
                      <div>Relationship: {generatedDraft.relationship.type} ({Math.round(generatedDraft.relationship.confidence * 100)}% confidence)</div>
                    </div>
                  </div>
                  {!isViewMode && (
                    <Button
                      onClick={handleSendToDraft}
                      disabled={isUploadingDraft || getDestinationFolder(generatedDraft.meta?.recommendedAction).error}
                      variant={getDestinationFolder(generatedDraft.meta?.recommendedAction).error ? "destructive" : "default"}
                    >
                      {isUploadingDraft ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          {getDestinationFolder(generatedDraft.meta?.recommendedAction).error ? (
                            <AlertCircle className="mr-2 h-4 w-4" />
                          ) : (
                            <Send className="mr-2 h-4 w-4" />
                          )}
                          {getDestinationFolder(generatedDraft.meta?.recommendedAction).buttonLabel}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {generatedDraft.body ? (
                  <div className="bg-muted p-4 rounded-md">
                    <pre className="whitespace-pre-wrap font-sans text-sm">{generatedDraft.body}</pre>
                  </div>
                ) : (
                  <div className="bg-muted p-4 rounded-md text-center text-muted-foreground">
                    {getDestinationFolder(generatedDraft.meta?.recommendedAction).isAmbiguous ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-yellow-600 dark:text-yellow-500">⚠️ Ambiguous Intent Detected</p>
                        <p className="text-sm">This email&apos;s intent is unclear. It will remain in your inbox for manual review. Please read carefully and decide on the appropriate action.</p>
                      </div>
                    ) : (
                      <p className="text-sm">No response needed - this email will be filed to {getDestinationFolder(generatedDraft.meta?.recommendedAction).folder}</p>
                    )}
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
                          <div className="text-sm font-medium text-muted-foreground mb-1">Destination Folder</div>
                          <Badge
                            variant="default"
                            className={
                              getDestinationFolder(generatedDraft.meta.recommendedAction).isAmbiguous
                                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                                : ''
                            }
                          >
                            <FolderOpen className="mr-1 h-3 w-3" />
                            {getDestinationFolder(generatedDraft.meta.recommendedAction).displayName}
                          </Badge>
                        </div>

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
                <p>Generate a draft to see the response here</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Add some basic email content styling */}
      <style jsx>{`
        .email-content img {
          max-width: 100%;
          height: auto;
        }
        .email-content a {
          color: #6366f1;
          text-decoration: underline;
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
