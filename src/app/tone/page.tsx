'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Loader2, Download, Trash2, BarChart3 } from 'lucide-react'
import { ImapLogViewer } from '@/components/imap-log-viewer'
import { useToast } from '@/hooks/use-toast'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface WritingPatterns {
  sentencePatterns: {
    avgLength: number
    medianLength: number
    trimmedMean: number
    minLength: number
    maxLength: number
    stdDeviation: number
    percentile25: number
    percentile75: number
    distribution?: {
      short: number
      medium: number
      long: number
    }
  }
  paragraphPatterns: Array<{
    type?: string
    structure?: string
    percentage: number
    description?: string
  }>
  openingPatterns: Array<{
    pattern?: string
    text?: string
    percentage: number
    frequency?: number
  }>
  valediction: Array<{
    phrase: string
    percentage: number
  }>
  negativePatterns: Array<{
    expression?: string
    description?: string
    alternatives?: string[]
    confidence?: number
    context?: string
  }>
  responsePatterns?: {
    immediate: number
    contemplative: number
    questionHandling: string
  }
  uniqueExpressions: Array<{
    phrase: string
    context: string
    frequency?: number
    occurrenceRate?: number
  }>
}

interface ToneProfile extends Partial<WritingPatterns> {
  meta?: {
    modelUsed?: string
    corpusSize?: number
    sentenceStats?: {
      lastCalculated: string
      totalSentences: number
      calculationMethod: string
    }
    [key: string]: unknown
  }
  emails_analyzed: number
  last_updated: string
  preference_type: string
}

interface ToneData {
  profiles: Record<string, ToneProfile>
  totalEmailsAnalyzed: number
  totalEmailsLoaded: number
  lastUpdated: string | null
}

interface EmailAccount {
  id: string
  email_address: string
}

const formatNumber = (value: number | null | undefined, decimals: number = 1): string => {
  if (value === null || value === undefined) return '0'
  return value.toFixed(decimals)
}

// Reusable Stat component
const Stat = ({ label, value, description }: { label: string; value: string | number; description?: string }) => (
  <div>
    <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
    <p className="text-xl font-semibold">{value}</p>
    {description && <p className="text-xs text-zinc-500 mt-1">{description}</p>}
  </div>
)

// Reusable Pattern Row component
const PatternRow = ({ label, value, showProgress = true }: { label: string; value: number; showProgress?: boolean }) => {
  const percentage = value * 100
  const displayValue = percentage > 0 && percentage < 1 ? '< 1%' : `${Math.round(percentage)}%`

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {showProgress && <Progress value={percentage} className="w-24 h-2" />}
        <span className="text-sm text-zinc-600 dark:text-zinc-400 w-12 text-right">
          {displayValue}
        </span>
      </div>
    </div>
  )
}

export default function TonePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [toneData, setToneData] = useState<ToneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedRelationship, setSelectedRelationship] = useState<string>('aggregate')
  const [mainTab, setMainTab] = useState<'training' | 'tuning' | 'results'>('training')

  // Training toolbar state
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [emailCount, setEmailCount] = useState('100')
  const [isLoadingEmails, setIsLoadingEmails] = useState(false)
  const [isWiping, setIsWiping] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // User preferences state
  const [userPreferences, setUserPreferences] = useState<{
    name: string
    nicknames: string
    signatureBlock: string
  } | null>(null)

  const { success, error } = useToast()
  const apiUrl = process.env.NEXT_PUBLIC_API_URL!

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/signin')
    }
  }, [user, authLoading, router])

  const fetchToneData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`${apiUrl}/api/tone-profile`, {
        credentials: 'include'
      })

      if (!response.ok) throw new Error('Failed to fetch tone profile')

      const data = await response.json()
      setToneData(data)

      if (data.profiles.aggregate) {
        setSelectedRelationship('aggregate')
      } else {
        const firstKey = Object.keys(data.profiles)[0]
        if (firstKey) setSelectedRelationship(firstKey)
      }
    } catch (err) {
      console.error('Error fetching tone data:', err)
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  const fetchEmailAccounts = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/email-accounts`, {
        credentials: 'include'
      })
      const accounts = await response.json()
      setEmailAccounts(accounts || [])
      if (accounts && accounts.length > 0) {
        setSelectedAccountId(accounts[0].id)
      }
    } catch (err) {
      console.error('Error fetching email accounts:', err)
    }
  }, [apiUrl])

  const fetchUserPreferences = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/settings/profile`, {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        setUserPreferences(data.preferences)
      }
    } catch (err) {
      console.error('Error fetching user preferences:', err)
    }
  }, [apiUrl])

  useEffect(() => {
    if (user) {
      fetchToneData()
      fetchEmailAccounts()
      fetchUserPreferences()
    }
  }, [user, fetchToneData, fetchEmailAccounts, fetchUserPreferences])

  const handleLoadEmails = async () => {
    if (!selectedAccountId) {
      error('Please select an email account')
      return
    }

    setIsLoadingEmails(true)
    try {
      const response = await fetch(`${apiUrl}/api/training/load-sent-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAccountId: selectedAccountId,
          limit: parseInt(emailCount)
        })
      })

      if (response.ok) {
        const data = await response.json()
        success(`Loading ${data.count || emailCount} emails...`)
        setTimeout(() => fetchToneData(), 2000)
      } else {
        const data = await response.json()
        error(data.error || 'Failed to load emails')
      }
    } catch (err) {
      error('Failed to load emails')
      console.error('Error:', err)
    } finally {
      setIsLoadingEmails(false)
    }
  }

  const handleWipeData = async () => {
    setIsWiping(true)
    try {
      const response = await fetch(`${apiUrl}/api/training/wipe`, {
        method: 'POST',
        credentials: 'include'
      })

      if (response.ok) {
        success('Emails wiped successfully')
        fetchToneData()
      } else {
        error('Failed to wipe data')
      }
    } catch (err) {
      error('Failed to wipe data')
      console.error('Error:', err)
    } finally {
      setIsWiping(false)
    }
  }

  const handleAnalyzePatterns = async () => {
    setIsAnalyzing(true)
    try {
      const response = await fetch(`${apiUrl}/api/training/analyze-patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: user?.id })
      })

      if (response.ok) {
        success('Pattern analysis started...')
        setTimeout(() => fetchToneData(), 2000)
      } else {
        const data = await response.json()
        error(data.error || 'Failed to analyze patterns')
      }
    } catch (err) {
      error('Failed to analyze patterns')
      console.error('Error:', err)
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) return null

  const hasProfiles = toneData && Object.keys(toneData.profiles).length > 0
  const currentProfile = hasProfiles ? toneData.profiles[selectedRelationship] : null
  const patterns = currentProfile as WritingPatterns

  // Sort profiles with 'aggregate' (Overall) first
  const sortedProfiles = hasProfiles ? Object.entries(toneData.profiles).sort(([keyA], [keyB]) => {
    if (keyA === 'aggregate') return -1
    if (keyB === 'aggregate') return 1
    return keyA.localeCompare(keyB)
  }) : []

  return (
    <div className="container mx-auto py-6 px-4 md:px-6 flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <div className="mb-6 flex-shrink-0">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-zinc-900">Tone Analysis</h1>
          <p className="text-zinc-600 mt-1">
            {toneData && toneData.totalEmailsLoaded > 0
              ? `Analyze your writing style from ${toneData.totalEmailsLoaded} emails`
              : 'Build your tone profile by loading and analyzing emails'
            }
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex-1 flex flex-col min-h-0">
        <Tabs value={mainTab} onValueChange={(value) => setMainTab(value as 'training' | 'tuning' | 'results')} className="flex flex-col flex-1 min-h-0">
          <TabsList className="grid w-full grid-cols-3 mb-4 flex-shrink-0">
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="tuning">Tuning</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
          </TabsList>

          {/* Training Tab */}
          <TabsContent value="training" className="mt-0 flex-1 flex flex-col min-h-0">
            <Card className="flex flex-col flex-1 min-h-0">
              <CardHeader className="flex-shrink-0">
                <CardTitle>Training</CardTitle>
                <CardDescription>Load and analyze emails from your account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 flex flex-col flex-1 min-h-0">
                {/* Compact Toolbar */}
                <div className="flex gap-2 items-center flex-shrink-0">
                  {/* Email Account Selector */}
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger className="w-[280px] h-7 text-xs">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id} className="text-xs">
                          {account.email_address}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Email Count Input */}
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="email-count" className="text-xs font-medium text-zinc-600">
                      Count
                    </label>
                    <Input
                      id="email-count"
                      type="number"
                      value={emailCount}
                      onChange={(e) => setEmailCount(e.target.value)}
                      placeholder="100"
                      className="w-[80px] h-7 text-xs"
                    />
                  </div>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Action Buttons */}
                  <Button
                    onClick={handleLoadEmails}
                    disabled={isLoadingEmails}
                    className="bg-indigo-600 hover:bg-indigo-700 h-7 px-2 text-xs"
                  >
                    {isLoadingEmails ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1" />
                    )}
                    Load Emails
                  </Button>

                  <Button
                    onClick={handleAnalyzePatterns}
                    disabled={isAnalyzing}
                    className="bg-emerald-600 hover:bg-emerald-700 h-7 px-2 text-xs"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <BarChart3 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Analyze Patterns
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="hover:bg-red-50 border-red-200 text-red-600 hover:text-red-700 h-7 px-2 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Wipe Data
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>⚠️ Wipe Vector Database</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete all stored email data from the database. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleWipeData} className="bg-red-600 hover:bg-red-700">
                          {isWiping ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              Wiping...
                            </>
                          ) : (
                            '🗑 Wipe Data'
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Real-Time Logs */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ImapLogViewer emailAccountId="" className="h-full" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tuning Tab */}
          <TabsContent value="tuning" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Tuning</CardTitle>
                <CardDescription>Fine-tune your tone analysis settings</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-500">TBD</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="mt-0 overflow-y-auto">
            {!hasProfiles ? (
              <Card>
                <CardHeader>
                  <CardTitle>No Results Yet</CardTitle>
                  <CardDescription>Load and analyze emails from the Training tab to see your tone profile</CardDescription>
                </CardHeader>
                <CardContent>
                  {emailAccounts.length === 0 ? (
                    <>
                      <p className="text-sm text-zinc-600 mb-4">You need to add an email account first.</p>
                      <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
                        <a href="/settings/email-accounts">Add Email Account</a>
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-600 mb-4">Switch to the Training tab to get started.</p>
                      <Button onClick={() => setMainTab('training')} className="bg-indigo-600 hover:bg-indigo-700">
                        Go to Training
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
            <div className="space-y-6">
              {/* Sentence Patterns */}
              <Card>
                <CardHeader>
                  <CardTitle>Sentence Structure</CardTitle>
                  <CardDescription>Statistics from your email send history by relationship type</CardDescription>
                  {/* Relationship Selector */}
                  <ToggleGroup
                    type="single"
                    value={selectedRelationship}
                    onValueChange={(value) => {
                      if (value) setSelectedRelationship(value)
                    }}
                    className="w-full justify-start rounded-none border-b border-zinc-200 dark:border-zinc-800 mt-4"
                  >
                    {sortedProfiles.map(([key, profile]) => (
                      <ToggleGroupItem
                        key={key}
                        value={key}
                        className="text-xs capitalize !rounded-none border-b-2 border-transparent data-[state=on]:border-indigo-600 data-[state=on]:bg-transparent data-[state=on]:shadow-none hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        {key === 'aggregate' ? 'Overall' : key}
                        <Badge variant="secondary" className="ml-1.5 text-xs">
                          {profile.emails_analyzed}
                        </Badge>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="border-l-4 border-indigo-500 pl-3">
                        <Stat
                          label="Median Length"
                          value={`${formatNumber(patterns?.sentencePatterns?.medianLength || patterns?.sentencePatterns?.avgLength)} words`}
                          description="Most representative"
                        />
                      </div>
                      <Stat
                        label="Trimmed Mean"
                        value={`${formatNumber(patterns?.sentencePatterns?.trimmedMean || patterns?.sentencePatterns?.avgLength)} words`}
                        description="Excludes outliers"
                      />
                      <Stat
                        label="Average"
                        value={`${formatNumber(patterns?.sentencePatterns?.avgLength)} words`}
                        description="All sentences"
                      />
                    </div>

                    <div className="grid grid-cols-4 gap-4 pt-4 border-t">
                      <Stat
                        label="Range"
                        value={`${patterns?.sentencePatterns?.minLength || 0} - ${patterns?.sentencePatterns?.maxLength || 0}`}
                      />
                      <Stat
                        label="Middle 50%"
                        value={`${formatNumber(patterns?.sentencePatterns?.percentile25, 0)} - ${formatNumber(patterns?.sentencePatterns?.percentile75, 0)}`}
                      />
                      <Stat label="Std Dev" value={formatNumber(patterns?.sentencePatterns?.stdDeviation)} />
                      <Stat
                        label="Variability"
                        value={`${patterns?.sentencePatterns?.stdDeviation && patterns?.sentencePatterns?.avgLength ? formatNumber((patterns.sentencePatterns.stdDeviation / patterns.sentencePatterns.avgLength) * 100, 0) : '0'}%`}
                      />
                    </div>

                    {patterns?.sentencePatterns?.distribution && (
                      <div className="pt-4 border-t">
                        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">Length Distribution</p>
                        <div className="space-y-2">
                          <PatternRow label="Short sentences" value={patterns.sentencePatterns.distribution.short} />
                          <PatternRow label="Medium sentences" value={patterns.sentencePatterns.distribution.medium} />
                          <PatternRow label="Long sentences" value={patterns.sentencePatterns.distribution.long} />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Opening Patterns */}
                <Card>
                  <CardHeader>
                    <CardTitle>Email Openings</CardTitle>
                    <CardDescription>How you start your emails</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {patterns?.openingPatterns && patterns.openingPatterns.length > 0 ? (
                        patterns.openingPatterns.map((pattern, idx) => (
                          <PatternRow
                            key={idx}
                            label={pattern.text || pattern.pattern || 'Unknown'}
                            value={pattern.percentage || pattern.frequency || 0}
                          />
                        ))
                      ) : (
                        <p className="text-sm text-zinc-500">No opening patterns found</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Paragraph Patterns */}
                {patterns?.paragraphPatterns && patterns.paragraphPatterns.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Paragraph Structure</CardTitle>
                      <CardDescription>How you organize your content</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {patterns.paragraphPatterns.map((pattern, idx) => (
                          <PatternRow
                            key={idx}
                            label={pattern.type || pattern.structure || 'Unknown'}
                            value={pattern.percentage / 100}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Response Patterns */}
                {patterns?.responsePatterns && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Response Style</CardTitle>
                      <CardDescription>How you typically respond</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Immediate responses</p>
                          <div className="flex items-center gap-2">
                            <Progress value={(patterns.responsePatterns.immediate || 0) * 100} className="flex-1 h-2" />
                            <span className="text-sm font-medium">{Math.round((patterns.responsePatterns.immediate || 0) * 100)}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Contemplative responses</p>
                          <div className="flex items-center gap-2">
                            <Progress value={(patterns.responsePatterns.contemplative || 0) * 100} className="flex-1 h-2" />
                            <span className="text-sm font-medium">{Math.round((patterns.responsePatterns.contemplative || 0) * 100)}%</span>
                          </div>
                        </div>
                      </div>
                      {patterns.responsePatterns.questionHandling && (
                        <div className="pt-4 border-t">
                          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Question handling style</p>
                          <p className="text-sm mt-1">{patterns.responsePatterns.questionHandling}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Closing Patterns */}
                <div className="grid grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Valedictions</CardTitle>
                      <CardDescription>How you sign off</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {patterns?.valediction && patterns.valediction.length > 0 ? (
                          patterns.valediction.map((pattern, idx) => (
                            <PatternRow
                              key={idx}
                              label={pattern.phrase}
                              value={pattern.percentage / 100}
                            />
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">No valediction patterns found</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Name Signature</CardTitle>
                      <CardDescription>How you sign your emails</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {userPreferences && (userPreferences.name || userPreferences.nicknames || userPreferences.signatureBlock) ? (
                        <>
                          {userPreferences.name && (
                            <div>
                              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Name</p>
                              <p className="text-sm">{userPreferences.name}</p>
                            </div>
                          )}
                          {userPreferences.nicknames && (
                            <div>
                              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Nicknames</p>
                              <p className="text-sm">{userPreferences.nicknames}</p>
                            </div>
                          )}
                          {userPreferences.signatureBlock && (
                            <div>
                              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Signature Block</p>
                              <pre className="text-xs bg-zinc-50 dark:bg-zinc-800 p-2 rounded whitespace-pre-wrap">{userPreferences.signatureBlock}</pre>
                            </div>
                          )}
                          <Button variant="outline" size="sm" asChild className="mt-2">
                            <a href="/settings">Edit Settings</a>
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-zinc-500">No signature configured</p>
                          <Button variant="outline" size="sm" asChild>
                            <a href="/settings">Configure Settings</a>
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Unique Expressions */}
                <Card>
                  <CardHeader>
                    <CardTitle>Unique Expressions</CardTitle>
                    <CardDescription>Phrases that are distinctively yours</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {patterns?.uniqueExpressions && patterns.uniqueExpressions.length > 0 ? (
                        patterns.uniqueExpressions.slice(0, 10).map((expr, idx) => (
                          <div key={idx} className="border-b border-zinc-100 dark:border-zinc-800 pb-3 last:border-0">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium">{expr.phrase}</p>
                                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{expr.context}</p>
                              </div>
                              <Badge variant="secondary" className="ml-2">
                                {Math.round((expr.occurrenceRate || expr.frequency || 0) * 100)}%
                              </Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-zinc-500">No unique expressions found</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Things to Avoid */}
                {patterns?.negativePatterns && patterns.negativePatterns.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Expressions to Avoid</CardTitle>
                      <CardDescription>Phrases you typically don&apos;t use</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {patterns.negativePatterns.map((pattern, idx) => (
                          <div key={idx} className="border-b border-zinc-100 dark:border-zinc-800 pb-3 last:border-0">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                                  Avoid: &quot;{pattern.expression || pattern.description || 'Unknown'}&quot;
                                </p>
                                {pattern.alternatives && pattern.alternatives.length > 0 && (
                                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                    Try instead: {pattern.alternatives.join(', ')}
                                  </p>
                                )}
                                {pattern.context && (
                                  <p className="text-xs text-zinc-500 mt-1">Context: {pattern.context}</p>
                                )}
                              </div>
                              {pattern.confidence && (
                                <Badge variant="secondary" className="ml-2 text-xs">
                                  {Math.round(pattern.confidence * 100)}%
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Analysis Details */}
                {currentProfile && (
                <Card>
                  <CardHeader>
                    <CardTitle>Analysis Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <Stat label="Emails Analyzed" value={currentProfile.emails_analyzed} />
                      <Stat label="Last Updated" value={new Date(currentProfile.last_updated).toLocaleDateString()} />
                      {(() => {
                        const modelUsed = currentProfile.meta?.modelUsed
                        return modelUsed && typeof modelUsed === 'string' ? (
                          <Stat label="AI Model" value={modelUsed} />
                        ) : null
                      })()}
                      {(() => {
                        const corpusSize = currentProfile.meta?.corpusSize
                        return corpusSize && typeof corpusSize === 'number' ? (
                          <Stat label="Sample Size" value={`${corpusSize} emails`} />
                        ) : null
                      })()}
                      {(() => {
                        const confidence = currentProfile.meta?.confidence
                        return confidence && typeof confidence === 'number' ? (
                          <Stat label="Confidence" value={`${Math.round(confidence * 100)}%`} />
                        ) : null
                      })()}
                      {currentProfile.meta?.sentenceStats && (
                        <>
                          <Stat label="Analysis Method" value="Direct calculation" />
                          <Stat
                            label="Sentences Analyzed"
                            value={currentProfile.meta.sentenceStats.totalSentences.toLocaleString()}
                          />
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
