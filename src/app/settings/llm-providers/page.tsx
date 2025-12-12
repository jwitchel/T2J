'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Check } from 'lucide-react'
import useSWR, { mutate } from 'swr'
import { PageHeader } from '@/components/patterns'

interface LLMProvider {
  id: string
  provider_name: string
  provider_type: 'openai' | 'anthropic' | 'google' | 'local'
  api_endpoint?: string
  model_name: string
  is_active: boolean
  is_default: boolean
  created_at: string
  updated_at: string
}

interface ProviderFormData {
  provider_name: string
  provider_type: 'openai' | 'anthropic' | 'google' | 'local'
  api_key: string
  api_endpoint?: string
  model_name: string
  is_default?: boolean
}

const PROVIDER_MODELS = {
  openai: [
    { value: 'gpt-4-turbo-preview', label: 'GPT-4 Turbo' },
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
  ],
  google: [
    { value: 'gemini-pro', label: 'Gemini Pro' },
    { value: 'gemini-pro-vision', label: 'Gemini Pro Vision' },
  ],
  local: [
    { value: 'llama-2-7b', label: 'Llama 2 7B' },
    { value: 'llama-2-13b', label: 'Llama 2 13B' },
    { value: 'mixtral-8x7b', label: 'Mixtral 8x7B' },
  ],
}

const PROVIDER_INFO = {
  openai: {
    name: 'OpenAI',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    endpointPlaceholder: 'https://api.openai.com/v1 (optional)',
  },
  anthropic: {
    name: 'Anthropic',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    endpointPlaceholder: 'https://api.anthropic.com (optional)',
  },
  google: {
    name: 'Google AI',
    keyPrefix: '',
    keyPlaceholder: 'AIza...',
    endpointPlaceholder: 'https://generativelanguage.googleapis.com (optional)',
  },
  local: {
    name: 'Local Model',
    keyPrefix: '',
    keyPlaceholder: 'Optional API key',
    endpointPlaceholder: 'http://localhost:8080 (required)',
  },
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((res) => res.json())

export default function LLMProvidersPage() {
  const {
    data: providers,
    error,
    isLoading,
  } = useSWR<LLMProvider[]>(`${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers`, fetcher)
  const { success, error: showError } = useToast()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [connectionTested, setConnectionTested] = useState(false)
  const [formData, setFormData] = useState<ProviderFormData>({
    provider_name: '',
    provider_type: 'openai',
    api_key: '',
    api_endpoint: '',
    model_name: 'gpt-3.5-turbo',
    is_default: false,
  })

  // Auto-detect provider type from API key
  useEffect(() => {
    if (formData.api_key) {
      if (formData.api_key.startsWith('sk-ant-')) {
        setFormData((prev) => ({
          ...prev,
          provider_type: 'anthropic',
          model_name: 'claude-3-sonnet-20240229',
        }))
      } else if (formData.api_key.startsWith('sk-')) {
        setFormData((prev) => ({ ...prev, provider_type: 'openai', model_name: 'gpt-3.5-turbo' }))
      } else if (formData.api_key.startsWith('AIza')) {
        setFormData((prev) => ({ ...prev, provider_type: 'google', model_name: 'gemini-pro' }))
      }
    }
  }, [formData.api_key])

  const testConnection = async () => {
    setIsTesting(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (response.ok) {
        success('Connection test successful!')
        setConnectionTested(true)
      } else {
        showError(data.message || 'Connection test failed')
        setConnectionTested(false)
      }
    } catch {
      showError('Network error. Please check your connection.')
      setConnectionTested(false)
    } finally {
      setIsTesting(false)
    }
  }

  const handleAdd = async () => {
    if (!connectionTested) {
      showError('Please test the connection before saving')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (response.ok) {
        success('LLM provider added successfully')
        setIsAddDialogOpen(false)
        resetForm()
        mutate(`${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers`)
      } else {
        showError(data.error || 'Failed to add provider')
      }
    } catch {
      showError('Network error. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!selectedProvider) return

    setIsSaving(true)
    try {
      const updateData: Record<string, string | boolean> = {
        provider_name: formData.provider_name,
        model_name: formData.model_name,
        is_default: formData.is_default || false,
      }

      // Only include API key if it was changed
      if (formData.api_key && formData.api_key !== '••••••••') {
        updateData.api_key = formData.api_key
      }

      if (formData.api_endpoint) {
        updateData.api_endpoint = formData.api_endpoint
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers/${selectedProvider.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updateData),
        }
      )

      const data = await response.json()

      if (response.ok) {
        success('LLM provider updated successfully')
        setIsEditDialogOpen(false)
        setSelectedProvider(null)
        resetForm()
        mutate(`${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers`)
      } else {
        showError(data.error || 'Failed to update provider')
      }
    } catch {
      showError('Network error. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedProvider) return

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers/${selectedProvider.id}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      )

      if (response.ok) {
        success('LLM provider deleted successfully')
        setSelectedProvider(null)
        mutate(`${process.env.NEXT_PUBLIC_API_URL!}/api/llm-providers`)
      } else {
        const data = await response.json()
        showError(data.error || 'Failed to delete provider')
      }
    } catch {
      showError('Network error. Please try again.')
    }
  }

  const openEditDialog = (provider: LLMProvider) => {
    setSelectedProvider(provider)
    setFormData({
      provider_name: provider.provider_name,
      provider_type: provider.provider_type,
      api_key: '••••••••', // Placeholder for existing key
      api_endpoint: provider.api_endpoint || '',
      model_name: provider.model_name,
      is_default: provider.is_default,
    })
    setConnectionTested(true) // Already tested when created
    setIsEditDialogOpen(true)
  }

  const openAddDialog = () => {
    resetForm()
    setIsAddDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({
      provider_name: '',
      provider_type: 'openai',
      api_key: '',
      api_endpoint: '',
      model_name: 'gpt-3.5-turbo',
      is_default: false,
    })
    setConnectionTested(false)
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Alert className="mx-auto max-w-md">
          <AlertDescription>Failed to load LLM providers. Please try again later.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6 md:px-6">
      <PageHeader
        title="LLM Providers"
        description="Configure AI providers for generating email replies"
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Connected Providers</h2>
          <Button onClick={openAddDialog}>Add Provider</Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </CardContent>
          </Card>
        ) : providers && providers.length > 0 ? (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="font-medium">{provider.provider_name}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {PROVIDER_INFO[provider.provider_type].name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{provider.model_name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={provider.is_active ? 'default' : 'secondary'}>
                        {provider.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {provider.is_default && <Badge variant="default">Default</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => openEditDialog(provider)}
                        >
                          Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" className="h-7 px-2 text-xs">
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete LLM Provider</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete &quot;{provider.provider_name}
                                &quot;? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  setSelectedProvider(provider)
                                  handleDelete()
                                }}
                              >
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
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <Plus className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
              <p className="text-muted-foreground mb-4">No LLM providers configured yet</p>
              <Button onClick={openAddDialog}>Add Provider</Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add LLM Provider</DialogTitle>
            <DialogDescription>
              Configure a new AI provider for generating email replies
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="provider_name">Provider Name</Label>
              <Input
                id="provider_name"
                placeholder="e.g., Work OpenAI"
                value={formData.provider_name}
                onChange={(e) => setFormData({ ...formData, provider_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_key">API Key</Label>
              <Input
                id="api_key"
                type="password"
                placeholder={PROVIDER_INFO[formData.provider_type].keyPlaceholder}
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                Your API key will be encrypted and stored securely
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider_type">Provider Type</Label>
              <Select
                value={formData.provider_type}
                onValueChange={(value: 'openai' | 'anthropic' | 'google' | 'local') => {
                  setFormData({
                    ...formData,
                    provider_type: value,
                    model_name: PROVIDER_MODELS[value][0].value,
                  })
                  setConnectionTested(false)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                    <SelectItem key={key} value={key}>
                      {info.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model_name">Model</Label>
              <Select
                value={formData.model_name}
                onValueChange={(value) => {
                  setFormData({ ...formData, model_name: value })
                  setConnectionTested(false)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_MODELS[formData.provider_type].map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_endpoint">API Endpoint (Optional)</Label>
              <Input
                id="api_endpoint"
                placeholder={PROVIDER_INFO[formData.provider_type].endpointPlaceholder}
                value={formData.api_endpoint}
                onChange={(e) => setFormData({ ...formData, api_endpoint: e.target.value })}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_default"
                className="rounded border-gray-300"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              />
              <Label htmlFor="is_default" className="font-normal">
                Set as default provider
              </Label>
            </div>

            {connectionTested && (
              <Alert className="border-green-200 bg-green-50">
                <Check className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Connection test successful! You can now save the provider.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={!formData.provider_name || !formData.api_key || isTesting}
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
            <Button onClick={handleAdd} disabled={!connectionTested || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Add Provider'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Provider Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit LLM Provider</DialogTitle>
            <DialogDescription>Update provider configuration</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit_provider_name">Provider Name</Label>
              <Input
                id="edit_provider_name"
                value={formData.provider_name}
                onChange={(e) => setFormData({ ...formData, provider_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_api_key">API Key</Label>
              <Input
                id="edit_api_key"
                type="password"
                placeholder="Leave blank to keep current key"
                value={formData.api_key}
                onChange={(e) => {
                  setFormData({ ...formData, api_key: e.target.value })
                  if (e.target.value && e.target.value !== '••••••••') {
                    setConnectionTested(false)
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Provider Type</Label>
              <Input
                value={PROVIDER_INFO[formData.provider_type].name}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_model_name">Model</Label>
              <Select
                value={formData.model_name}
                onValueChange={(value) => setFormData({ ...formData, model_name: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_MODELS[formData.provider_type].map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_api_endpoint">API Endpoint</Label>
              <Input
                id="edit_api_endpoint"
                placeholder={PROVIDER_INFO[formData.provider_type].endpointPlaceholder}
                value={formData.api_endpoint}
                onChange={(e) => setFormData({ ...formData, api_endpoint: e.target.value })}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="edit_is_default"
                className="rounded border-gray-300"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              />
              <Label htmlFor="edit_is_default" className="font-normal">
                Set as default provider
              </Label>
            </div>
          </div>
          <DialogFooter>
            {formData.api_key && formData.api_key !== '••••••••' && !connectionTested && (
              <Button variant="outline" onClick={testConnection} disabled={isTesting}>
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test New Key'
                )}
              </Button>
            )}
            <Button
              onClick={handleEdit}
              disabled={
                isSaving ||
                (!!formData.api_key && formData.api_key !== '••••••••' && !connectionTested)
              }
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
