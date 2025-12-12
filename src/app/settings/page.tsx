'use client'

import { ProtectedRoute } from '@/components/auth/protected-route'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SignaturePatterns } from '@/components/settings/signature-patterns'
import { TypedNameSettings } from '@/components/settings/typed-name-settings'
import { useState, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader, SectionCard } from '@/components/patterns'

export default function SettingsPage() {
  const { user } = useAuth()
  const { success, error } = useToast()
  const [name, setName] = useState('')
  const [nicknames, setNicknames] = useState('')
  const [signatureBlock, setSignatureBlock] = useState('')
  const [folderPreferences, setFolderPreferences] = useState({
    rootFolder: '',
    noActionFolder: '',
    spamFolder: '',
    todoFolder: '',
  })
  const [actionPreferences, setActionPreferences] = useState({
    spamDetection: true,
    silentActions: {
      'silent-fyi-only': true,
      'silent-large-list': true,
      'silent-unsubscribe': true,
      'silent-todo': true,
    },
    draftGeneration: true,
  })
  const [workDomainsCSV, setWorkDomainsCSV] = useState('')
  const [familyEmailsCSV, setFamilyEmailsCSV] = useState('')
  const [spouseEmailsCSV, setSpouseEmailsCSV] = useState('')
  const [originalWorkDomainsCSV, setOriginalWorkDomainsCSV] = useState('')
  const [originalFamilyEmailsCSV, setOriginalFamilyEmailsCSV] = useState('')
  const [originalSpouseEmailsCSV, setOriginalSpouseEmailsCSV] = useState('')
  const [recategorization, setRecategorization] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTestingFolders, setIsTestingFolders] = useState(false)
  const [isCreatingFolders, setIsCreatingFolders] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderTestResult, setFolderTestResult] = useState<{
    requiredFolders?: string[]
    existing?: string[]
    missing?: string[]
    accounts?: Array<{
      accountId: string
      email: string
      success: boolean
      existing?: string[]
      missing?: string[]
      error?: string
    }>
  } | null>(null)

  // Load user preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      if (!user?.id) return

      setIsLoading(true)
      try {
        const data = await apiGet<{
          preferences: {
            name?: string
            nicknames?: string
            signatureBlock?: string
            folderPreferences?: {
              rootFolder?: string
              noActionFolder?: string
              spamFolder?: string
              todoFolder?: string
            }
            actionPreferences?: {
              spamDetection?: boolean
              silentActions?: {
                'silent-fyi-only'?: boolean
                'silent-large-list'?: boolean
                'silent-unsubscribe'?: boolean
                'silent-todo'?: boolean
              }
              draftGeneration?: boolean
            }
            workDomainsCSV?: string
            familyEmailsCSV?: string
            spouseEmailsCSV?: string
          }
        }>('/api/settings/profile')
        if (data.preferences) {
          setName(data.preferences.name || user.name || '')
          setNicknames(data.preferences.nicknames || '')
          setSignatureBlock(data.preferences.signatureBlock || '')
          const workDomains = data.preferences.workDomainsCSV || ''
          const familyEmails = data.preferences.familyEmailsCSV || ''
          const spouseEmails = data.preferences.spouseEmailsCSV || ''
          setWorkDomainsCSV(workDomains)
          setFamilyEmailsCSV(familyEmails)
          setSpouseEmailsCSV(spouseEmails)
          setOriginalWorkDomainsCSV(workDomains)
          setOriginalFamilyEmailsCSV(familyEmails)
          setOriginalSpouseEmailsCSV(spouseEmails)
          if (data.preferences.folderPreferences) {
            setFolderPreferences((prev) => ({
              ...prev,
              ...data.preferences.folderPreferences,
            }))
          }
          if (data.preferences.actionPreferences) {
            setActionPreferences((prev) => ({
              ...prev,
              spamDetection:
                data.preferences.actionPreferences?.spamDetection ?? prev.spamDetection,
              silentActions: {
                'silent-fyi-only':
                  data.preferences.actionPreferences?.silentActions?.['silent-fyi-only'] ??
                  prev.silentActions['silent-fyi-only'],
                'silent-large-list':
                  data.preferences.actionPreferences?.silentActions?.['silent-large-list'] ??
                  prev.silentActions['silent-large-list'],
                'silent-unsubscribe':
                  data.preferences.actionPreferences?.silentActions?.['silent-unsubscribe'] ??
                  prev.silentActions['silent-unsubscribe'],
                'silent-todo':
                  data.preferences.actionPreferences?.silentActions?.['silent-todo'] ??
                  prev.silentActions['silent-todo'],
              },
              draftGeneration:
                data.preferences.actionPreferences?.draftGeneration ?? prev.draftGeneration,
            }))
          }
        } else {
          setName(user.name || '')
        }
      } catch (err) {
        console.error('Failed to load preferences:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadPreferences()
  }, [user])

  const handleSave = async () => {
    setIsSaving(true)
    setRecategorization([])

    // Track which relationship fields changed
    const spouseChanged = spouseEmailsCSV !== originalSpouseEmailsCSV
    const familyChanged = familyEmailsCSV !== originalFamilyEmailsCSV
    const workChanged = workDomainsCSV !== originalWorkDomainsCSV

    try {
      const response = await apiPost<{
        success: boolean
        preferences: Record<string, unknown>
        recategorization?: {
          updated: number
          breakdown: { spouse: number; family: number; colleague: number }
        }
      }>('/api/settings/profile', {
        name,
        nicknames,
        signatureBlock,
        workDomainsCSV,
        familyEmailsCSV,
        spouseEmailsCSV,
      })

      if (response.recategorization && response.recategorization.updated > 0) {
        const messages: string[] = []
        const { breakdown } = response.recategorization

        if (spouseChanged && breakdown.spouse > 0) {
          messages.push(
            `${breakdown.spouse} spouse ${breakdown.spouse === 1 ? 'email' : 'emails'} updated`
          )
        }
        if (familyChanged && breakdown.family > 0) {
          messages.push(
            `${breakdown.family} family ${breakdown.family === 1 ? 'email' : 'emails'} updated`
          )
        }
        if (workChanged && breakdown.colleague > 0) {
          messages.push(
            `${breakdown.colleague} work ${breakdown.colleague === 1 ? 'email' : 'emails'} updated`
          )
        }

        setRecategorization(messages)

        // Update original values after successful save
        setOriginalWorkDomainsCSV(workDomainsCSV)
        setOriginalFamilyEmailsCSV(familyEmailsCSV)
        setOriginalSpouseEmailsCSV(spouseEmailsCSV)

        success(`Profile updated! Re-categorized ${response.recategorization.updated} contacts.`)
      } else {
        // Update original values after successful save
        setOriginalWorkDomainsCSV(workDomainsCSV)
        setOriginalFamilyEmailsCSV(familyEmailsCSV)
        setOriginalSpouseEmailsCSV(spouseEmailsCSV)

        success('Profile updated successfully')
      }
    } catch (err) {
      error('Failed to update profile')
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Unified folder settings flow:
   * 1. User clicks "Save Folder Settings"
   * 2. We test folders on IMAP (using current UI values, not saved values)
   * 3. Show modal with results
   * 4. If all exist → auto-save and close
   * 5. If missing → show "Create Folders" button
   * 6. On create success → save preferences and close
   */
  const handleSaveFolderSettings = async () => {
    setIsTestingFolders(true)
    setFolderTestResult(null)

    try {
      // First, temporarily save the preferences so test-folders uses them
      await apiPost('/api/settings/folder-preferences', folderPreferences)

      // Then test folders
      const result = await apiPost<{
        success: boolean
        requiredFolders: string[]
        accounts: Array<{
          accountId: string
          email: string
          success: boolean
          existing?: string[]
          missing?: string[]
          error?: string
        }>
      }>('/api/settings/test-folders', {})

      // Combine results from all accounts
      const allExisting = new Set<string>()
      const allMissing = new Set<string>()
      let hasConnectionErrors = false

      result.accounts?.forEach((account) => {
        if (account.success) {
          account.existing?.forEach((f) => allExisting.add(f))
          account.missing?.forEach((f) => allMissing.add(f))
        } else {
          hasConnectionErrors = true
        }
      })

      const testResult = {
        ...result,
        existing: Array.from(allExisting),
        missing: Array.from(allMissing),
      }

      setFolderTestResult(testResult)

      // If all folders exist and no connection errors, save is complete
      if (allMissing.size === 0 && !hasConnectionErrors) {
        success('Folder settings saved! All folders verified.')
      } else {
        // Show modal for user to create missing folders or acknowledge errors
        setFolderDialogOpen(true)
      }
    } catch (err) {
      error('Failed to test folders')
      console.error(err)
    } finally {
      setIsTestingFolders(false)
    }
  }

  const handleCreateFoldersInModal = async () => {
    setIsCreatingFolders(true)

    try {
      const result = await apiPost<{
        success: boolean
        accounts: Array<{
          accountId: string
          email: string
          success: boolean
          created?: string[]
          failed?: Array<{ folder: string; error: string }>
          error?: string
        }>
      }>('/api/settings/create-folders', {})

      // Count total created and failed across all accounts
      let totalCreated = 0
      let totalFailed = 0
      let accountsWithErrors = 0

      result.accounts?.forEach((account) => {
        if (account.success) {
          totalCreated += account.created?.length || 0
          totalFailed += account.failed?.length || 0
        } else {
          accountsWithErrors++
        }
      })

      if (totalFailed > 0 || accountsWithErrors > 0) {
        // Some folders failed to create
        error(`Failed to create some folders. Please check your email account connections.`)
        // Re-test to show updated status
        const retestResult = await apiPost<{
          success: boolean
          requiredFolders: string[]
          accounts: Array<{
            accountId: string
            email: string
            success: boolean
            existing?: string[]
            missing?: string[]
            error?: string
          }>
        }>('/api/settings/test-folders', {})

        const allExisting = new Set<string>()
        const allMissing = new Set<string>()
        retestResult.accounts?.forEach((account) => {
          if (account.success) {
            account.existing?.forEach((f) => allExisting.add(f))
            account.missing?.forEach((f) => allMissing.add(f))
          }
        })

        setFolderTestResult({
          ...retestResult,
          existing: Array.from(allExisting),
          missing: Array.from(allMissing),
        })
      } else {
        // All folders created successfully - preferences already saved, close modal
        success(`Created ${totalCreated} folders. Settings saved!`)
        setFolderDialogOpen(false)
        setFolderTestResult(null)
      }
    } catch (err) {
      error('Failed to create folders')
      console.error(err)
    } finally {
      setIsCreatingFolders(false)
    }
  }

  const handleCancelFolderDialog = () => {
    setFolderDialogOpen(false)
    setFolderTestResult(null)
  }

  const [isSavingActionPreferences, setIsSavingActionPreferences] = useState(false)

  const handleSaveActionPreferences = async () => {
    setIsSavingActionPreferences(true)
    try {
      await apiPost('/api/settings/action-preferences', { actionPreferences })
      success('Action preferences saved')
    } catch (err) {
      error('Failed to save action preferences')
      console.error(err)
    } finally {
      setIsSavingActionPreferences(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <PageHeader title="Settings" className="mb-8" />

          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="mb-6 w-full">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="relationships">Relationships</TabsTrigger>
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="signatures">Signatures</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-6">
              <SectionCard
                title="Profile Information"
                description="Update your personal information"
                contentClassName="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nicknames">Nicknames</Label>
                  <Input
                    id="nicknames"
                    type="text"
                    value={nicknames}
                    onChange={(e) => setNicknames(e.target.value)}
                    placeholder="e.g. Jessica, Jess, JW"
                    disabled={isLoading}
                  />
                  <p className="text-muted-foreground text-sm">
                    Enter common nicknames or variations of your name, separated by commas
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" defaultValue={user?.email || ''} disabled />
                  <p className="text-muted-foreground text-sm">Email cannot be changed</p>
                </div>
                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </SectionCard>

              <SectionCard
                title="Typed Name Settings"
                description="Configure how your name appears in generated email responses"
              >
                <TypedNameSettings />
              </SectionCard>

              <SectionCard
                title="Email Signature Block"
                description="Add a signature that will be included in your generated email replies"
                contentClassName="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="signatureBlock">Signature Block</Label>
                  <Textarea
                    id="signatureBlock"
                    value={signatureBlock}
                    onChange={(e) => setSignatureBlock(e.target.value)}
                    placeholder={`---\nCell: 970-759-1403\nReplied on ${new Date().toLocaleDateString()}`}
                    className="min-h-[120px] font-mono text-sm"
                    disabled={isLoading}
                  />
                  <p className="text-muted-foreground text-sm">
                    This signature will be added to your email replies before the quoted original
                    message. You can use multiple lines.
                  </p>
                </div>
                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving...' : 'Save Signature'}
                </Button>
              </SectionCard>
            </TabsContent>

            <TabsContent value="relationships" className="space-y-6">
              <SectionCard
                title="Relationship Categorization"
                description="Configure domains and emails to automatically categorize contacts for more precise tone when drafting emails."
                contentClassName="space-y-6"
              >
                <div className="space-y-2">
                  <Label htmlFor="spouseEmailsCSV">Spouse/Partner Email Addresses (CSV)</Label>
                  <Input
                    id="spouseEmailsCSV"
                    type="text"
                    value={spouseEmailsCSV}
                    onChange={(e) => setSpouseEmailsCSV(e.target.value)}
                    placeholder="partner@example.com"
                    disabled={isLoading}
                  />
                  <p className="text-muted-foreground text-sm">
                    Enter spouse/partner email addresses separated by commas.
                    <br />
                    This person is treated as a special case when drafting emails to only use the
                    tone you use specifically for them.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="familyEmailsCSV">Family Email Addresses (CSV)</Label>
                  <Input
                    id="familyEmailsCSV"
                    type="text"
                    value={familyEmailsCSV}
                    onChange={(e) => setFamilyEmailsCSV(e.target.value)}
                    placeholder="dad@example.com, mom@gmail.com"
                    disabled={isLoading}
                  />
                  <p className="text-muted-foreground text-sm">
                    Enter family email addresses separated by commas. These contacts will be
                    categorized as &quot;family&quot;.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workDomainsCSV">Work Domains (CSV)</Label>
                  <Input
                    id="workDomainsCSV"
                    type="text"
                    value={workDomainsCSV}
                    onChange={(e) => setWorkDomainsCSV(e.target.value)}
                    placeholder="company.com, subsidiary.co.uk"
                    disabled={isLoading}
                  />
                  <p className="text-muted-foreground text-sm">
                    Enter work domains separated by commas. Anyone from these domains will be
                    categorized as &quot;colleague&quot;.
                  </p>
                </div>

                {recategorization.length > 0 && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                    <h4 className="mb-2 text-sm font-semibold text-green-900 dark:text-green-100">
                      Relationship Update Complete
                    </h4>
                    <ul className="mt-1 space-y-1 text-sm text-green-800 dark:text-green-200">
                      {recategorization.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </SectionCard>
            </TabsContent>

            <TabsContent value="services" className="space-y-6">
              <SectionCard
                title="Email Processing"
                description="Configure which processing stages are enabled. Unprocessed emails will remain in your inbox."
                contentClassName="space-y-6"
              >
                  {/* Spam Detection Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="spamDetection">Spam Detection</Label>
                      <p className="text-muted-foreground text-sm">
                        Detect and move spam emails to spam folder
                      </p>
                    </div>
                    <Switch
                      id="spamDetection"
                      checked={actionPreferences.spamDetection}
                      onCheckedChange={(checked) =>
                        setActionPreferences((prev) => ({ ...prev, spamDetection: checked }))
                      }
                      disabled={isLoading}
                    />
                  </div>

                  {/* Silent Actions Toggle with Sub-toggles */}
                  <div className="space-y-4">
                    <div className="space-y-0.5">
                      <Label>Organize Your Email</Label>
                      <p className="text-muted-foreground text-sm">
                        Automatically move emails that do <b>not</b> require a response to a
                        specific folder.
                      </p>
                    </div>

                    {/* Sub-toggles - indented */}
                    <div className="space-y-3 pl-6">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="silent-fyi-only" className="font-normal">
                          FYI Only.{' '}
                          <span className="text-muted-foreground">
                            Emails that do not require a response from you.
                          </span>
                        </Label>
                        <Switch
                          id="silent-fyi-only"
                          checked={actionPreferences.silentActions['silent-fyi-only']}
                          onCheckedChange={(checked) =>
                            setActionPreferences((prev) => ({
                              ...prev,
                              silentActions: { ...prev.silentActions, 'silent-fyi-only': checked },
                            }))
                          }
                          disabled={isLoading}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="silent-large-list" className="font-normal">
                          Large Distribution Lists.{' '}
                          <span className="text-muted-foreground">
                            Emails that are sent to a large number of people.
                          </span>
                        </Label>
                        <Switch
                          id="silent-large-list"
                          checked={actionPreferences.silentActions['silent-large-list']}
                          onCheckedChange={(checked) =>
                            setActionPreferences((prev) => ({
                              ...prev,
                              silentActions: {
                                ...prev.silentActions,
                                'silent-large-list': checked,
                              },
                            }))
                          }
                          disabled={isLoading}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="silent-unsubscribe" className="font-normal">
                          Unsubscribe Candidates.{' '}
                          <span className="text-muted-foreground">
                            Emails that are asking you to unsubscribe from a mailing list.
                          </span>
                        </Label>
                        <Switch
                          id="silent-unsubscribe"
                          checked={actionPreferences.silentActions['silent-unsubscribe']}
                          onCheckedChange={(checked) =>
                            setActionPreferences((prev) => ({
                              ...prev,
                              silentActions: {
                                ...prev.silentActions,
                                'silent-unsubscribe': checked,
                              },
                            }))
                          }
                          disabled={isLoading}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="silent-todo" className="font-normal">
                          Todo Items.{' '}
                          <span className="text-muted-foreground">
                            Emails that are asking you to complete a task.
                          </span>
                        </Label>
                        <Switch
                          id="silent-todo"
                          checked={actionPreferences.silentActions['silent-todo']}
                          onCheckedChange={(checked) =>
                            setActionPreferences((prev) => ({
                              ...prev,
                              silentActions: { ...prev.silentActions, 'silent-todo': checked },
                            }))
                          }
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Draft Generation Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="draftGeneration">Draft Generation</Label>
                      <p className="text-muted-foreground text-sm">
                        Upload AI-generated reply drafts to your Drafts folder
                      </p>
                    </div>
                    <Switch
                      id="draftGeneration"
                      checked={actionPreferences.draftGeneration}
                      onCheckedChange={(checked) =>
                        setActionPreferences((prev) => ({ ...prev, draftGeneration: checked }))
                      }
                      disabled={isLoading}
                    />
                  </div>

                  <Button
                    onClick={handleSaveActionPreferences}
                    disabled={isSavingActionPreferences || isLoading}
                  >
                    {isSavingActionPreferences ? 'Saving...' : 'Save Action Preferences'}
                  </Button>
              </SectionCard>

              <SectionCard
                title="Email Folder Preferences"
                description="Configure folders for organizing emails based on AI recommendations"
                contentClassName="space-y-4"
              >
                  <div className="space-y-2">
                    <Label htmlFor="rootFolder">Root Folder</Label>
                    <Input
                      id="rootFolder"
                      value={folderPreferences.rootFolder}
                      onChange={(e) =>
                        setFolderPreferences((prev) => ({ ...prev, rootFolder: e.target.value }))
                      }
                      placeholder="Leave empty for root level"
                      disabled={isLoading}
                    />
                    <p className="text-muted-foreground text-sm">
                      Leave empty to create folders at the root level
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="noActionFolder">No Action Folder</Label>
                    <Input
                      id="noActionFolder"
                      value={folderPreferences.noActionFolder}
                      onChange={(e) =>
                        setFolderPreferences((prev) => ({
                          ...prev,
                          noActionFolder: e.target.value,
                        }))
                      }
                      placeholder="e.g., *No Action"
                      disabled={isLoading}
                    />
                    <p className="text-muted-foreground text-sm">
                      For: FYI only, large lists, unsubscribe candidates. Names starting with *
                      appear at top.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="spamFolder">Spam Folder</Label>
                    <Input
                      id="spamFolder"
                      value={folderPreferences.spamFolder}
                      onChange={(e) =>
                        setFolderPreferences((prev) => ({ ...prev, spamFolder: e.target.value }))
                      }
                      placeholder="e.g., *Spam"
                      disabled={isLoading}
                    />
                    <p className="text-muted-foreground text-sm">
                      For: emails identified as spam. Names starting with * appear at top.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="todoFolder">Todo Folder</Label>
                    <Input
                      id="todoFolder"
                      value={folderPreferences.todoFolder}
                      onChange={(e) =>
                        setFolderPreferences((prev) => ({ ...prev, todoFolder: e.target.value }))
                      }
                      placeholder="e.g., *Todo"
                      disabled={isLoading}
                    />
                    <p className="text-muted-foreground text-sm">
                      For: action items requiring external action (no email response needed). Names
                      starting with * appear at top.
                    </p>
                  </div>

                  <Button
                    onClick={handleSaveFolderSettings}
                    disabled={isTestingFolders || isLoading}
                  >
                    {isTestingFolders ? 'Verifying...' : 'Save Folder Settings'}
                  </Button>
              </SectionCard>
            </TabsContent>

            <TabsContent value="signatures" className="space-y-6">
              <SectionCard
                title="Email Signature Detection"
                description="Configure patterns to automatically detect and remove your email signature when analyzing your writing style"
              >
                <SignaturePatterns />
              </SectionCard>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <SectionCard
                title="Security"
                description="Manage your password and security settings"
                contentClassName="space-y-4"
              >
                <Button variant="outline">Change Password</Button>
              </SectionCard>

              <SectionCard title="Danger Zone" description="Irreversible actions">
                <Button variant="destructive">Delete Account</Button>
              </SectionCard>
            </TabsContent>
          </Tabs>
      </div>

      {/* Folder Verification Dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Folder Verification</DialogTitle>
            <DialogDescription>
              {folderTestResult?.missing && folderTestResult.missing.length > 0
                ? 'Some folders need to be created on your email accounts.'
                : 'There were issues connecting to some accounts.'}
            </DialogDescription>
          </DialogHeader>

          {folderTestResult && (
            <div className="space-y-4">
              {/* Required Folders */}
              <div>
                <span className="text-sm font-medium">Required Folders:</span>
                <ul className="text-muted-foreground mt-1 list-inside list-disc text-sm">
                  {folderTestResult.requiredFolders?.map((folder: string) => (
                    <li key={folder}>{folder || 'Root Level'}</li>
                  ))}
                </ul>
              </div>

              {/* Per-Account Results */}
              <div className="space-y-3">
                <span className="text-sm font-medium">Account Status:</span>
                {folderTestResult.accounts?.map((account) => (
                  <div
                    key={account.accountId}
                    className="border-muted-foreground/20 ml-2 border-l-2 pl-3"
                  >
                    <div className="mb-1 text-sm font-medium">{account.email}</div>

                    {account.success ? (
                      <div className="space-y-1 text-xs">
                        {account.existing && account.existing.length > 0 && (
                          <div className="text-green-600">
                            ✓ Existing: {account.existing.join(', ')}
                          </div>
                        )}
                        {account.missing && account.missing.length > 0 && (
                          <div className="text-orange-600">
                            ⚠ Missing: {account.missing.join(', ')}
                          </div>
                        )}
                        {account.existing &&
                          folderTestResult.requiredFolders &&
                          account.existing.length === folderTestResult.requiredFolders.length && (
                            <div className="text-green-600">✓ All folders exist</div>
                          )}
                      </div>
                    ) : (
                      <div className="text-xs text-red-600">
                        ✗ Error: {account.error || 'Connection failed'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCancelFolderDialog}>
              Cancel
            </Button>
            {folderTestResult?.missing && folderTestResult.missing.length > 0 && (
              <Button onClick={handleCreateFoldersInModal} disabled={isCreatingFolders}>
                {isCreatingFolders ? 'Creating...' : 'Create Missing Folders'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  )
}
