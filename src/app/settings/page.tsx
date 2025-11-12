'use client'

import { ProtectedRoute } from '@/components/auth/protected-route'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    todoFolder: ''
  })
  const [workDomainsCSV, setWorkDomainsCSV] = useState('')
  const [familyEmailsCSV, setFamilyEmailsCSV] = useState('')
  const [spouseEmailsCSV, setSpouseEmailsCSV] = useState('')
  const [originalWorkDomainsCSV, setOriginalWorkDomainsCSV] = useState('')
  const [originalFamilyEmailsCSV, setOriginalFamilyEmailsCSV] = useState('')
  const [originalSpouseEmailsCSV, setOriginalSpouseEmailsCSV] = useState('')
  const [recategorization, setRecategorization] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTestingFolders, setIsTestingFolders] = useState(false)
  const [folderTestResult, setFolderTestResult] = useState<{
    requiredFolders?: string[];
    existing?: string[];
    missing?: string[];
    accounts?: Array<{
      accountId: string;
      email: string;
      success: boolean;
      existing?: string[];
      missing?: string[];
      error?: string;
    }>;
  } | null>(null)

  // Load user preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      if (!user?.id) return
      
      setIsLoading(true)
      try {
        const data = await apiGet<{ preferences: {
          name?: string;
          nicknames?: string;
          signatureBlock?: string;
          folderPreferences?: {
            rootFolder?: string;
            noActionFolder?: string;
            spamFolder?: string;
            todoFolder?: string;
          };
          workDomainsCSV?: string;
          familyEmailsCSV?: string;
          spouseEmailsCSV?: string;
        } }>('/api/settings/profile')
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
            setFolderPreferences(prev => ({
              ...prev,
              ...data.preferences.folderPreferences
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
        success: boolean;
        preferences: Record<string, unknown>;
        recategorization?: {
          updated: number;
          breakdown: { spouse: number; family: number; colleague: number };
        };
      }>('/api/settings/profile', {
        name,
        nicknames,
        signatureBlock,
        workDomainsCSV,
        familyEmailsCSV,
        spouseEmailsCSV
      })

      if (response.recategorization && response.recategorization.updated > 0) {
        const messages: string[] = []
        const { breakdown } = response.recategorization

        if (spouseChanged && breakdown.spouse > 0) {
          messages.push(`${breakdown.spouse} spouse ${breakdown.spouse === 1 ? 'email' : 'emails'} updated`)
        }
        if (familyChanged && breakdown.family > 0) {
          messages.push(`${breakdown.family} family ${breakdown.family === 1 ? 'email' : 'emails'} updated`)
        }
        if (workChanged && breakdown.colleague > 0) {
          messages.push(`${breakdown.colleague} work ${breakdown.colleague === 1 ? 'email' : 'emails'} updated`)
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

  const handleTestFolders = async () => {
    setIsTestingFolders(true)
    setFolderTestResult(null)
    
    try {
      const result = await apiPost<{
        success: boolean;
        requiredFolders: string[];
        accounts: Array<{
          accountId: string;
          email: string;
          success: boolean;
          existing?: string[];
          missing?: string[];
          error?: string;
        }>;
      }>('/api/settings/test-folders', {})
      
      // Combine results from all accounts
      const allExisting = new Set<string>()
      const allMissing = new Set<string>()
      
      result.accounts?.forEach(account => {
        if (account.success) {
          account.existing?.forEach(f => allExisting.add(f))
          account.missing?.forEach(f => allMissing.add(f))
        }
      })
      
      setFolderTestResult({
        ...result,
        existing: Array.from(allExisting),
        missing: Array.from(allMissing)
      })
      
      if (allMissing.size === 0) {
        success('All required folders exist across all accounts!')
      }
    } catch (err) {
      error('Failed to test folders')
      console.error(err)
    } finally {
      setIsTestingFolders(false)
    }
  }

  const handleCreateFolders = async () => {
    setIsTestingFolders(true)
    
    try {
      const result = await apiPost<{
        success: boolean;
        accounts: Array<{
          accountId: string;
          email: string;
          success: boolean;
          created?: string[];
          failed?: Array<{ folder: string; error: string }>;
          error?: string;
        }>;
      }>('/api/settings/create-folders', {})
      
      // Count total created and failed across all accounts
      let totalCreated = 0
      let totalFailed = 0
      let accountsWithErrors = 0
      
      result.accounts?.forEach(account => {
        if (account.success) {
          totalCreated += account.created?.length || 0
          totalFailed += account.failed?.length || 0
        } else {
          accountsWithErrors++
        }
      })
      
      if (totalCreated > 0) {
        success(`Created ${totalCreated} folders across ${result.accounts.length} accounts!`)
        // Re-test to update the display
        await handleTestFolders()
      }
      
      if (totalFailed > 0) {
        error(`Failed to create ${totalFailed} folders`)
      }
      
      if (accountsWithErrors > 0) {
        error(`${accountsWithErrors} accounts had connection errors`)
      }
    } catch (err) {
      error('Failed to create folders')
      console.error(err)
    } finally {
      setIsTestingFolders(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Settings</h1>

          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="w-full mb-6">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="relationships">Relationships</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="signatures">Signatures</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>Update your personal information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  <p className="text-sm text-muted-foreground">
                    Enter common nicknames or variations of your name, separated by commas
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    defaultValue={user?.email || ''}
                    disabled
                  />
                  <p className="text-sm text-muted-foreground">
                    Email cannot be changed
                  </p>
                </div>
                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Typed Name Settings</CardTitle>
                <CardDescription>Configure how your name appears in generated email responses</CardDescription>
              </CardHeader>
              <CardContent>
                <TypedNameSettings />
              </CardContent>
            </Card>
            </TabsContent>

            <TabsContent value="relationships" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Relationship Categorization</CardTitle>
                <CardDescription>
                  Configure domains and emails to automatically categorize contacts for more precise tone when drafting emails.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
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
                  <p className="text-sm text-muted-foreground">
                    Enter spouse/partner email addresses separated by commas.<br />
                    This person is treated as a special case when drafting emails to only use the tone you use specifically for them.
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
                  <p className="text-sm text-muted-foreground">
                    Enter family email addresses separated by commas. These contacts will be categorized as &quot;family&quot;.
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
                  <p className="text-sm text-muted-foreground">
                    Enter work domains separated by commas. Anyone from these domains will be categorized as &quot;colleague&quot;.
                  </p>
                </div>

                {recategorization.length > 0 && (
                  <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
                    <h4 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-2">
                      Relationship Update Complete
                    </h4>
                    <ul className="text-sm text-green-800 dark:text-green-200 mt-1 space-y-1">
                      {recategorization.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </CardContent>
            </Card>
            </TabsContent>

            <TabsContent value="email" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Email Signature Block</CardTitle>
                <CardDescription>
                  Add a signature that will be included in your generated email replies
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  <p className="text-sm text-muted-foreground">
                    This signature will be added to your email replies before the quoted original message.
                    You can use multiple lines.
                  </p>
                </div>
                <Button onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving...' : 'Save Signature'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Email Folder Preferences</CardTitle>
                <CardDescription>
                  Configure folders for organizing emails based on AI recommendations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rootFolder">Root Folder</Label>
                  <Input
                    id="rootFolder"
                    value={folderPreferences.rootFolder}
                    placeholder="Leave empty for root level"
                    disabled={true}
                    readOnly
                  />
                  <p className="text-sm text-muted-foreground">
                    Leave empty to create folders at the root level
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="noActionFolder">No Action Folder</Label>
                  <Input
                    id="noActionFolder"
                    value={folderPreferences.noActionFolder}
                    placeholder="e.g., AI-No-Action"
                    disabled={true}
                    readOnly
                  />
                  <p className="text-sm text-muted-foreground">
                    For: FYI only, large lists, unsubscribe candidates
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="spamFolder">Spam Folder</Label>
                  <Input
                    id="spamFolder"
                    value={folderPreferences.spamFolder}
                    placeholder="e.g., AI-Spam"
                    disabled={true}
                    readOnly
                  />
                  <p className="text-sm text-muted-foreground">
                    For: emails identified as spam
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="todoFolder">Todo Folder</Label>
                  <Input
                    id="todoFolder"
                    value={folderPreferences.todoFolder}
                    placeholder="t2j-todo"
                    disabled={true}
                    readOnly
                  />
                  <p className="text-sm text-muted-foreground">
                    For: action items requiring external action (no email response needed)
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleTestFolders}
                    disabled={isTestingFolders || isLoading}
                  >
                    {isTestingFolders ? 'Testing...' : 'Test Folders'}
                  </Button>
                </div>
                
                {folderTestResult && (
                  <div className="mt-4 p-4 bg-muted rounded-md">
                    <h4 className="font-medium mb-3">Folder Test Results</h4>
                    
                    {/* Required Folders */}
                    <div className="mb-4">
                      <span className="font-medium text-sm">Required Folders:</span>
                      <ul className="list-disc list-inside mt-1 text-sm text-muted-foreground">
                        {folderTestResult.requiredFolders?.map((folder: string) => (
                          <li key={folder}>{folder || 'Root Level'}</li>
                        ))}
                      </ul>
                    </div>
                    
                    {/* Per-Account Results */}
                    <div className="space-y-3">
                      <span className="font-medium text-sm">Account Status:</span>
                      {folderTestResult.accounts?.map((account) => (
                        <div key={account.accountId} className="border-l-2 border-muted-foreground/20 pl-3 ml-2">
                          <div className="font-medium text-sm mb-1">{account.email}</div>
                          
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
                              {account.existing && folderTestResult.requiredFolders && 
                               account.existing.length === folderTestResult.requiredFolders.length && (
                                <div className="text-green-600">
                                  ✓ All folders exist
                                </div>
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
                    
                    {/* Create Missing Folders Button */}
                    {folderTestResult.missing && folderTestResult.missing.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-muted-foreground/20">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={handleCreateFolders}
                          disabled={isTestingFolders}
                          className="w-full"
                        >
                          Create All Missing Folders
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2">
                          This will create missing folders on all connected accounts
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            </TabsContent>

            <TabsContent value="signatures" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Email Signature Detection</CardTitle>
                <CardDescription>
                  Configure patterns to automatically detect and remove your email signature when analyzing your writing style
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SignaturePatterns />
              </CardContent>
            </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>Manage your password and security settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button variant="outline">Change Password</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Danger Zone</CardTitle>
                <CardDescription>Irreversible actions</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive">Delete Account</Button>
              </CardContent>
            </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </ProtectedRoute>
  )
}
