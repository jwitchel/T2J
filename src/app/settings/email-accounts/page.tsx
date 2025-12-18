'use client'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import useSWR from 'swr'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Mail, Server, Eye, EyeOff, Info } from 'lucide-react'
import { EmailAccountResponse } from '@/types/email-account'
import { FcGoogle } from 'react-icons/fc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/patterns'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((res) => res.json())

const emailAccountSchema = z.object({
  email_address: z.string().email('Invalid email address'),
  imap_username: z.string().min(1, 'Username is required'),
  imap_password: z.string().min(1, 'Password is required'),
  imap_host: z.string().min(1, 'IMAP host is required'),
  imap_port: z.number().min(1).max(65535, 'Invalid port number'),
  imap_secure: z.boolean(),
})

function EmailAccountsContent() {
  const searchParams = useSearchParams()
  const reauthId = searchParams.get('reauth')
  const [isAddingAccount, setIsAddingAccount] = useState(false)
  const [editingAccount, setEditingAccount] = useState<EmailAccountResponse | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const {
    data: accounts,
    error,
    mutate,
  } = useSWR<EmailAccountResponse[]>(
    `${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts`,
    fetcher
  )
  const { success, error: showError } = useToast()

  const reauthAccount = useMemo(
    () => (accounts || []).find((a) => a.id === reauthId),
    [accounts, reauthId]
  )

  const handleDelete = async (accountId: string) => {
    setDeletingId(accountId)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts/${accountId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      )

      if (response.ok) {
        success('Email account deleted successfully')
        mutate()
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Failed to delete account')
      }
    } catch {
      showError('Network error. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleTest = async (account: EmailAccountResponse) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts/${account.id}/test`,
        {
          method: 'POST',
          credentials: 'include',
        }
      )

      if (response.ok) {
        const result = await response.json()
        success(result.message || 'Connection test successful!')
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Connection test failed')
      }
    } catch {
      showError('Network error. Please try again.')
    }
  }

  const handleToggleMonitoring = async (account: EmailAccountResponse, enabled: boolean) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts/${account.id}/monitoring`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled }),
        }
      )

      if (response.ok) {
        success(enabled ? 'Monitoring enabled' : 'Monitoring disabled')
        mutate()
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Failed to toggle monitoring')
      }
    } catch {
      showError('Network error. Please try again.')
    }
  }

  if (error) {
    return (
      <ProtectedRoute>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="text-center text-red-600">Failed to load email accounts</div>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {reauthAccount && (
          <div className="mb-4">
            <Alert className="border-amber-300 bg-amber-50 py-2 dark:bg-amber-950">
              <AlertDescription className="flex items-center justify-between">
                <span className="text-xs">
                  <strong>{reauthAccount.email_address}</strong> requires re-authorization. Click
                  reconnect to resume syncing.
                </span>
                <Button
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={async () => {
                    try {
                      const response = await fetch(
                        `${process.env.NEXT_PUBLIC_API_URL!}/api/oauth-direct/authorize`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({
                            provider: reauthAccount.oauth_provider || 'google',
                          }),
                        }
                      )
                      if (!response.ok) {
                        const err = await response.json()
                        showError(err.error || 'Failed to start OAuth flow')
                        return
                      }
                      const { authUrl } = await response.json()
                      window.location.href = authUrl
                    } catch {
                      showError('Failed to start OAuth flow')
                    }
                  }}
                >
                  Reconnect
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
        <PageHeader
          title="Email Accounts"
          description="Connect your email accounts to enable AI-powered email assistance"
          className="mb-8"
        />

        <AccountList
          accounts={accounts || []}
          isLoading={!accounts}
          onAdd={() => setIsAddingAccount(true)}
          onEdit={(account) => setEditingAccount(account)}
          onDelete={handleDelete}
          onTest={handleTest}
          onToggleMonitoring={handleToggleMonitoring}
          deletingId={deletingId}
        />

        {/* Add Account Dialog */}
        <AddAccountDialog
          open={isAddingAccount}
          onOpenChange={setIsAddingAccount}
          onSuccess={() => {
            setIsAddingAccount(false)
            mutate()
          }}
        />

        {/* Edit Account Dialog */}
        {editingAccount && (
          <EditAccountDialog
            account={editingAccount}
            open={!!editingAccount}
            onOpenChange={(open) => !open && setEditingAccount(null)}
            onSuccess={() => {
              setEditingAccount(null)
              mutate()
            }}
          />
        )}
      </div>
    </ProtectedRoute>
  )
}

function AccountList({
  accounts,
  isLoading,
  onAdd,
  onEdit,
  onDelete,
  onTest,
  onToggleMonitoring,
  deletingId,
}: {
  accounts: EmailAccountResponse[]
  isLoading: boolean
  onAdd: () => void
  onEdit: (account: EmailAccountResponse) => void
  onDelete: (id: string) => void
  onTest: (account: EmailAccountResponse) => void
  onToggleMonitoring: (account: EmailAccountResponse, enabled: boolean) => void
  deletingId: string | null
}) {
  const { error: showError } = useToast()
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Mail className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <p className="text-muted-foreground mb-4">No email accounts connected yet</p>
          <Button onClick={onAdd}>Add Email Account</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Connected Accounts</h2>
        <Button onClick={onAdd}>Add Account</Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Monitoring</TableHead>
              <TableHead>Last Sync</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell className="font-medium">
                  <div>
                    {account.email_address}
                    {account.oauth_provider && (
                      <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                        <FcGoogle className="h-3 w-3" />
                        Connected via OAuth
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-muted-foreground flex items-center gap-1 text-sm">
                    <Server className="h-3 w-3" />
                    {account.imap_host}:{account.imap_port}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {account.monitoring_enabled ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="text-muted-foreground h-4 w-4" />
                    )}
                    <Switch
                      checked={account.monitoring_enabled || false}
                      onCheckedChange={(checked) => onToggleMonitoring(account, checked)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  {account.last_sync ? new Date(account.last_sync).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {account.oauth_provider ? (
                      <Button
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={async () => {
                          try {
                            const response = await fetch(
                              `${process.env.NEXT_PUBLIC_API_URL!}/api/oauth-direct/authorize`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ provider: account.oauth_provider }),
                              }
                            )
                            if (!response.ok) {
                              const err = await response.json()
                              showError(err.error || 'Failed to start OAuth flow')
                              return
                            }
                            const { authUrl } = await response.json()
                            window.location.href = authUrl
                          } catch {
                            showError('Failed to start OAuth flow')
                          }
                        }}
                      >
                        Reconnect
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => onTest(account)}
                        >
                          Test
                        </Button>
                        <Button
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => onEdit(account)}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          className="h-7 px-2 text-xs"
                          disabled={deletingId === account.id}
                        >
                          {deletingId === account.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Delete'
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Email Account</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete {account.email_address}? This action
                            cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(account.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function AddAccountDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [connectionTested, setConnectionTested] = useState(false)
  const { success, error: showError } = useToast()

  const form = useForm<z.infer<typeof emailAccountSchema>>({
    resolver: zodResolver(emailAccountSchema),
    defaultValues: {
      email_address: '',
      imap_username: '',
      imap_password: '',
      imap_host: 'localhost',
      imap_port: 1143,
      imap_secure: false,
    },
  })

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset()
      setConnectionTested(false)
    }
  }, [open, form])

  // Auto-detect provider settings
  const handleEmailChange = (email: string) => {
    form.setValue('imap_username', email) // Default username to email

    if (email.endsWith('@gmail.com')) {
      form.setValue('imap_host', 'imap.gmail.com')
      form.setValue('imap_port', 993)
      form.setValue('imap_secure', true)
    } else if (email.includes('@outlook') || email.includes('@hotmail')) {
      form.setValue('imap_host', 'outlook.office365.com')
      form.setValue('imap_port', 993)
      form.setValue('imap_secure', true)
    } else if (email.includes('@yahoo')) {
      form.setValue('imap_host', 'imap.mail.yahoo.com')
      form.setValue('imap_port', 993)
      form.setValue('imap_secure', true)
    } else if (
      email.includes('@icloud.com') ||
      email.includes('@me.com') ||
      email.includes('@mac.com')
    ) {
      form.setValue('imap_host', 'imap.mail.me.com')
      form.setValue('imap_port', 993)
      form.setValue('imap_secure', true)
    } else if (email.endsWith('@testmail.local')) {
      // Keep test server defaults
      form.setValue('imap_host', 'localhost')
      form.setValue('imap_port', 1143)
      form.setValue('imap_secure', false)
    }
  }

  const testConnection = async () => {
    const isValid = await form.trigger()
    if (!isValid) return

    const data = form.getValues()
    setIsTesting(true)

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      })

      if (response.ok) {
        success('Connection test successful! You can now save the account.')
        setConnectionTested(true)
      } else {
        const errorData = await response.json()
        showError(errorData.message || 'Connection test failed')
        setConnectionTested(false)
      }
    } catch {
      showError('Network error. Please check your connection and try again.')
      setConnectionTested(false)
    } finally {
      setIsTesting(false)
    }
  }

  const onSubmit = async (data: z.infer<typeof emailAccountSchema>) => {
    setIsSubmitting(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      })

      if (response.ok) {
        success('Email account added successfully!')
        onSuccess()
      } else {
        const errorData = await response.json()
        if (errorData.error === 'Email account already exists') {
          showError('This email account is already connected')
        } else if (errorData.error === 'IMAP authentication failed') {
          showError('Invalid email or password. Please check your credentials.')
        } else if (errorData.error === 'IMAP connection failed') {
          showError('Could not connect to email server. Please check the server settings.')
        } else if (errorData.error === 'IMAP connection timeout') {
          showError('Connection timed out. Please check your network and server settings.')
        } else {
          showError(errorData.error || 'Failed to add email account')
        }
      }
    } catch {
      showError('Network error. Please check your connection and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Email Account</DialogTitle>
          <DialogDescription>
            Connect your email account to enable AI-powered assistance
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* OAuth Section */}
          <div className="text-center">
            <h4 className="mb-2 text-sm font-semibold">Connect with OAuth (Recommended)</h4>
            <p className="text-muted-foreground mb-4 text-xs">
              The most secure way to connect your email account
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={async () => {
                try {
                  const response = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL!}/api/oauth-direct/authorize`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ provider: 'google' }),
                    }
                  )

                  if (!response.ok) {
                    const error = await response.json()
                    showError(error.error || 'Failed to start OAuth flow')
                    return
                  }

                  const { authUrl } = await response.json()
                  window.location.href = authUrl
                } catch (error) {
                  console.error('OAuth error:', error)
                  showError('Failed to connect with Google. Please try again.')
                }
              }}
            >
              <FcGoogle className="mr-2 h-5 w-5" />
              Connect with Google
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background text-muted-foreground px-2">Or connect manually</span>
            </div>
          </div>

          {/* Manual Connection Help - using Collapsible to avoid nested Dialog issues */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="mx-auto flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400">
                <Info className="h-4 w-4" />
                Manual connection settings
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-2 rounded-md border p-4 text-sm">
              <div>
                <span className="font-medium">Gmail:</span>
                <span className="text-muted-foreground">
                  {' '}
                  imap.gmail.com:993 (SSL)
                </span>
                <span className="mt-1 block text-xs text-blue-600 dark:text-blue-400">
                  Requires app-specific password.{' '}
                  <a
                    href="https://support.google.com/mail/answer/185833"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Learn how
                  </a>
                </span>
              </div>
              <div>
                <span className="font-medium">Outlook/Hotmail:</span>
                <span className="text-muted-foreground">
                  {' '}
                  outlook.office365.com:993 (SSL)
                </span>
              </div>
              <div>
                <span className="font-medium">Yahoo:</span>
                <span className="text-muted-foreground">
                  {' '}
                  imap.mail.yahoo.com:993 (SSL)
                </span>
              </div>
              <div>
                <span className="font-medium">iCloud:</span>
                <span className="text-muted-foreground">
                  {' '}
                  imap.mail.me.com:993 (SSL)
                </span>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Manual Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e)
                          handleEmailChange(e.target.value)
                        }}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      For testing: user1@testmail.local
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="imap_username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IMAP Username</FormLabel>
                    <FormControl>
                      <Input placeholder="Usually your email address" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="imap_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Your email password" {...field} />
                    </FormControl>
                    <FormDescription className="text-xs">
                      For Gmail, use an app-specific password
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="imap_host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IMAP Server</FormLabel>
                      <FormControl>
                        <Input placeholder="imap.gmail.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="imap_port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IMAP Port</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="993"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {connectionTested && (
                <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    Connection test successful! You can now save the account.
                  </AlertDescription>
                </Alert>
              )}

              <DialogFooter className="gap-2 pt-4 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={testConnection}
                  disabled={isTesting || isSubmitting}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Account'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditAccountDialog({
  account,
  open,
  onOpenChange,
  onSuccess,
}: {
  account: EmailAccountResponse
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [connectionTested, setConnectionTested] = useState(false)
  const { success, error: showError } = useToast()

  const form = useForm<z.infer<typeof emailAccountSchema>>({
    resolver: zodResolver(emailAccountSchema),
    defaultValues: {
      email_address: account.email_address,
      imap_username: account.imap_username,
      imap_password: '', // Password field starts empty for security
      imap_host: account.imap_host,
      imap_port: account.imap_port,
      imap_secure: account.imap_secure,
    },
  })

  // Reset form when account changes
  useEffect(() => {
    if (open && account) {
      form.reset({
        email_address: account.email_address,
        imap_username: account.imap_username,
        imap_password: '',
        imap_host: account.imap_host,
        imap_port: account.imap_port,
        imap_secure: account.imap_secure,
      })
      setConnectionTested(false)
    }
  }, [open, account, form])

  const testConnection = async () => {
    const isValid = await form.trigger()
    if (!isValid) return

    const data = form.getValues()
    setIsTesting(true)

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      })

      if (response.ok) {
        success('Connection test successful! You can now update the account.')
        setConnectionTested(true)
      } else {
        const errorData = await response.json()
        showError(errorData.message || 'Connection test failed')
        setConnectionTested(false)
      }
    } catch {
      showError('Network error. Please check your connection and try again.')
      setConnectionTested(false)
    } finally {
      setIsTesting(false)
    }
  }

  const onSubmit = async (data: z.infer<typeof emailAccountSchema>) => {
    setIsSubmitting(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/email-accounts/${account.id}/update-credentials`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            imap_host: data.imap_host,
            imap_port: data.imap_port,
            imap_username: data.imap_username,
            imap_password: data.imap_password,
          }),
        }
      )

      if (response.ok) {
        success('Email account credentials updated successfully!')
        onSuccess()
      } else {
        const errorData = await response.json()
        showError(errorData.error || 'Failed to update email account')
      }
    } catch {
      showError('Failed to update email account. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Email Account</DialogTitle>
          <DialogDescription>
            Update your email account settings. You&apos;ll need to re-enter your password.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="email_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} disabled className="bg-muted" />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Email address cannot be changed
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imap_username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IMAP Username</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imap_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Enter new password" {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Re-enter your password to save changes
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="imap_host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IMAP Server</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="imap_port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IMAP Port</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {connectionTested && (
              <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                <AlertDescription className="text-green-800 dark:text-green-200">
                  Connection test successful! You can now save the account.
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2 pt-4 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={testConnection}
                disabled={isTesting || isSubmitting}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Account'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Loading fallback component
function EmailAccountsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Email Accounts"
        description="Connect your email accounts to enable AI-powered email assistance"
        className="mb-8"
      />
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    </div>
  )
}

// Main export with Suspense boundary
export default function EmailAccountsPage() {
  return (
    <Suspense fallback={<EmailAccountsLoading />}>
      <EmailAccountsContent />
    </Suspense>
  )
}
