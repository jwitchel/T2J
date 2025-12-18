'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2,
  Upload,
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Brain,
  Mail,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface EmailAccount {
  id: string
  email_address: string
  oauth_provider?: string
}

interface TrainingPanelProps {
  emailAccountId: string
  userId: string
  emailAddress?: string
  collapsible?: boolean
}

export function TrainingPanel({
  emailAccountId: defaultAccountId,
  userId,
  collapsible = true,
}: TrainingPanelProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [isWiping, setIsWiping] = useState(false)
  const [showWipeDialog, setShowWipeDialog] = useState(false)
  const [isAnalyzingPatterns, setIsAnalyzingPatterns] = useState(false)
  const [emailCount, setEmailCount] = useState('100')
  // Default to tomorrow to include all emails up to today
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const [startDate, setStartDate] = useState(tomorrow.toISOString().split('T')[0])
  const [progress, setProgress] = useState<{
    processed: number
    total: number
    errors: number
    percentage: number
  } | null>(null)
  const { success, error } = useToast()

  // Email account selection state
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>(defaultAccountId)
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)

  // Fetch email accounts
  useEffect(() => {
    const fetchEmailAccounts = async () => {
      try {
        const response = await fetch('/api/email-accounts', {
          credentials: 'include',
        })
        if (response.ok) {
          const accounts = await response.json()
          setEmailAccounts(accounts)
          setIsLoadingAccounts(false)
        } else {
          console.error('Failed to fetch email accounts')
          setIsLoadingAccounts(false)
        }
      } catch (err) {
        console.error('Error fetching email accounts:', err)
        setIsLoadingAccounts(false)
      }
    }

    fetchEmailAccounts()
  }, [])

  // Update selected account when default changes
  useEffect(() => {
    setSelectedAccountId(defaultAccountId)
  }, [defaultAccountId])

  // Listen for WebSocket progress updates
  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => {
      ws.send(JSON.stringify({ userId }))
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.command === 'TRAINING_PROGRESS') {
        setProgress(data.data.parsed)
      } else if (data.command === 'TRAINING_COMPLETE') {
        setProgress(null)
        success(
          `Training complete! Processed ${data.data.parsed.processed} emails with ${data.data.parsed.errors} errors.`
        )
        // Close WebSocket after training is complete
        setTimeout(() => {
          ws.close()
        }, 500)
      } else if (
        data.command === 'TRAINING_EMAIL_ERROR' ||
        data.command === 'TRAINING_BATCH_ERROR'
      ) {
        // Don't stop loading on individual errors
        console.error('Training error:', data.data.error)
      }
    }

    ws.onerror = () => {
      console.error('WebSocket error')
      setProgress(null)
    }

    ws.onclose = () => {
      // Reset progress when WebSocket closes
      setProgress(null)
    }

    return ws
  }

  const handleLoadEmails = async () => {
    if (selectedAccountId === 'demo-account-001') {
      error('Please select a real email account from the dropdown above to train from')
      return
    }

    setProgress(null)

    // Connect to WebSocket for progress updates
    const ws = connectWebSocket()

    try {
      const response = await fetch('/api/training/load-sent-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          emailAccountId: selectedAccountId,
          limit: parseInt(emailCount),
          startDate: new Date(startDate).toISOString(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load emails')
      }

      // WebSocket will handle the success message
    } catch (err) {
      setProgress(null)
      error(err instanceof Error ? err.message : 'Failed to load emails')
      // Close WebSocket on error
      ws.close()
    }
  }

  const handleWipeData = async () => {
    setShowWipeDialog(false)
    setIsWiping(true)

    try {
      const response = await fetch('/api/training/wipe', {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to wipe data')
      }

      success('All training data has been wiped from the vector database')
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to wipe data')
    } finally {
      setIsWiping(false)
    }
  }

  const handleAnalyzePatterns = async () => {
    setIsAnalyzingPatterns(true)

    try {
      const response = await fetch('/api/training/analyze-patterns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          force: true, // Force re-analysis even if patterns exist
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to analyze patterns')
      }

      const result = await response.json()
      success(
        `Pattern analysis complete! Analyzed ${result.emailsAnalyzed} emails across ${result.relationshipsAnalyzed} relationships.`
      )
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to analyze patterns')
    } finally {
      setIsAnalyzingPatterns(false)
    }
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden pt-0">
      {collapsible ? (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-between p-0 hover:bg-transparent"
              >
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Upload className="h-4 w-4" />
                  Training Panel
                </CardTitle>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-3 pt-0">
              <Alert className="py-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Load your sent emails into the vector database for tone learning
                </AlertDescription>
              </Alert>

              {/* Email Account Selection */}
              <div className="space-y-2">
                <Label htmlFor="email-account" className="flex items-center gap-1 text-xs">
                  <Mail className="h-3 w-3" />
                  Email Account
                </Label>
                <Select
                  value={selectedAccountId}
                  onValueChange={setSelectedAccountId}
                  disabled={isLoadingAccounts || emailAccounts.length === 0}
                >
                  <SelectTrigger id="email-account" className="h-8 text-sm">
                    <SelectValue
                      placeholder={
                        isLoadingAccounts
                          ? 'Loading accounts...'
                          : emailAccounts.length === 0
                            ? 'No email accounts'
                            : 'Select an email account'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {emailAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <div className="flex items-center gap-2">
                          <span>{account.email_address}</span>
                          {account.oauth_provider && (
                            <span className="text-muted-foreground text-xs">(OAuth)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedAccountId === 'demo-account-001' && (
                <Alert className="py-2" variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Please select a real email account to train from
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <div>
                  <Label htmlFor="email-count" className="text-xs">
                    Number of Emails
                  </Label>
                  <Input
                    id="email-count"
                    type="number"
                    min="1"
                    max="5000"
                    value={emailCount}
                    onChange={(e) => setEmailCount(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="start-date" className="text-xs">
                    Load Emails Up To (Inclusive)
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Fetches the {emailCount} most recent emails sent on or before this date
                  </p>
                </div>
              </div>

              {progress && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-600">
                    <span>
                      Processing: {progress.processed}/{progress.total}
                    </span>
                    <span>{progress.percentage}%</span>
                  </div>
                  <Progress value={progress.percentage} className="h-2" />
                  {progress.errors > 0 && (
                    <p className="text-xs text-red-600">{progress.errors} errors encountered</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    onClick={handleLoadEmails}
                    disabled={
                      selectedAccountId === 'demo-account-001' || emailAccounts.length === 0
                    }
                    size="sm"
                    className="flex-1"
                  >
                    <Upload className="mr-1 h-3 w-3" />
                    Load Emails
                  </Button>

                  <Button
                    onClick={handleAnalyzePatterns}
                    disabled={isAnalyzingPatterns}
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    title="Analyze writing patterns from loaded emails"
                  >
                    {isAnalyzingPatterns ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Brain className="mr-1 h-3 w-3" />
                        Analyze Patterns
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={() => setShowWipeDialog(true)}
                    disabled={isWiping}
                    size="sm"
                    variant="destructive"
                  >
                    {isWiping ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>

              <AlertDialog open={showWipeDialog} onOpenChange={setShowWipeDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Wipe Training Data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all your training data from the vector database.
                      You&apos;ll need to re-load your emails to use tone learning features.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleWipeData}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Wipe Data
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <>
          <div className="flex h-10 flex-shrink-0 items-center justify-between border-b px-2 py-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Training</h3>
            </div>
          </div>
          <CardContent className="space-y-2 px-2 pt-0">
            {/* Email Account Selection */}
            <div className="space-y-1">
              <Label htmlFor="email-account-nc" className="text-xs">
                Account
              </Label>
              <Select
                value={selectedAccountId}
                onValueChange={setSelectedAccountId}
                disabled={isLoadingAccounts || emailAccounts.length === 0}
              >
                <SelectTrigger id="email-account-nc" className="h-7 text-xs">
                  <SelectValue
                    placeholder={
                      isLoadingAccounts
                        ? 'Loading...'
                        : emailAccounts.length === 0
                          ? 'No accounts'
                          : 'Select account'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {emailAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      <span className="text-xs">{account.email_address}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedAccountId === 'demo-account-001' && (
              <Alert className="py-1" variant="destructive">
                <AlertDescription className="text-[10px]">Select a real account</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1">
              <div>
                <Label htmlFor="email-count-nc" className="text-xs">
                  Count
                </Label>
                <Input
                  id="email-count-nc"
                  type="number"
                  min="1"
                  max="5000"
                  value={emailCount}
                  onChange={(e) => setEmailCount(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="start-date-nc" className="text-xs">
                  Up To Date
                </Label>
                <Input
                  id="start-date-nc"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            </div>

            {progress && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-zinc-600">
                  <span>
                    {progress.processed}/{progress.total}
                  </span>
                  <span>{progress.percentage}%</span>
                </div>
                <Progress value={progress.percentage} className="h-1.5" />
                {progress.errors > 0 && (
                  <p className="text-[10px] text-red-600">{progress.errors} errors</p>
                )}
              </div>
            )}

            <div className="space-y-1 pt-1">
              <Button
                onClick={handleLoadEmails}
                disabled={selectedAccountId === 'demo-account-001' || emailAccounts.length === 0}
                size="sm"
                className="h-7 w-full text-xs"
              >
                <Upload className="mr-1 h-3 w-3" />
                Load Emails
              </Button>

              <Button
                onClick={handleAnalyzePatterns}
                disabled={isAnalyzingPatterns}
                size="sm"
                variant="secondary"
                className="h-7 w-full text-xs"
                title="Analyze writing patterns from loaded emails"
              >
                {isAnalyzingPatterns ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="mr-1 h-3 w-3" />
                    Analyze
                  </>
                )}
              </Button>

              <Button
                onClick={() => setShowWipeDialog(true)}
                disabled={isWiping}
                size="sm"
                variant="destructive"
                className="h-7 w-full text-xs"
              >
                {isWiping ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Wiping...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1 h-3 w-3" />
                    Wipe Data
                  </>
                )}
              </Button>
            </div>

            <AlertDialog open={showWipeDialog} onOpenChange={setShowWipeDialog}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Wipe Training Data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all your training data from the vector database.
                    You&apos;ll need to re-load your emails to use tone learning features.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleWipeData}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Wipe Data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </>
      )}
    </Card>
  )
}
