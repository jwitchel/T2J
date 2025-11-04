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
        const data = await apiGet<{ preferences: { name?: string; nicknames?: string; signatureBlock?: string; folderPreferences?: {
          rootFolder?: string;
          noActionFolder?: string;
          spamFolder?: string;
          todoFolder?: string;
        } } }>('/api/settings/profile')
        if (data.preferences) {
          setName(data.preferences.name || user.name || '')
          setNicknames(data.preferences.nicknames || '')
          setSignatureBlock(data.preferences.signatureBlock || '')
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
    try {
      await apiPost('/api/settings/profile', {
        name,
        nicknames,
        signatureBlock
      })
      success('Profile updated successfully')
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
            <TabsList className="grid w-full grid-cols-4 mb-6">
              <TabsTrigger value="profile">Profile</TabsTrigger>
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
