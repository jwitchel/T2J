'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useForm } from 'react-hook-form';
import { TextFieldElement, SelectElement, SwitchElement, PasswordElement } from 'react-hook-form-mui';
import {
  Box,
  Card,
  CardContent,
  Paper,
  Typography,
  Button,
  ButtonGroup,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
  Skeleton,
  Alert,
  Stack,
  useMediaQuery,
  List,
  ListItem,
  ListItemText,
  IconButton,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { useConfirm } from '@/components/confirm-dialog';
import { useAuth } from '@/lib/auth-context';
import { usePageTitle } from '@/hooks/use-page-title';
import { MuiAuthenticatedLayout } from '@/components/mui';

// Types
interface LLMProvider {
  id: string;
  provider_name: string;
  provider_type: 'openai' | 'anthropic' | 'google' | 'local';
  api_endpoint?: string;
  model_name: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface ProviderFormData {
  provider_name: string;
  provider_type: 'openai' | 'anthropic' | 'google' | 'local';
  api_key: string;
  api_endpoint?: string;
  model_name: string;
  is_default?: boolean;
}

// Constants
const PROVIDER_MODELS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-4-turbo-preview', label: 'GPT-4 Turbo Preview' },
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
  ],
  google: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-pro', label: 'Gemini Pro' },
  ],
  local: [
    { value: 'llama3.2', label: 'Llama 3.2' },
    { value: 'llama3.1', label: 'Llama 3.1' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'mixtral', label: 'Mixtral' },
    { value: 'qwen2.5-coder', label: 'Qwen 2.5 Coder' },
  ],
};

const PROVIDER_INFO = {
  openai: {
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    endpointPlaceholder: 'https://api.openai.com/v1 (optional)',
  },
  anthropic: {
    name: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    endpointPlaceholder: 'https://api.anthropic.com (optional)',
  },
  google: {
    name: 'Google AI',
    keyPlaceholder: 'AIza...',
    endpointPlaceholder: 'https://generativelanguage.googleapis.com (optional)',
  },
  local: {
    name: 'Local Model',
    keyPlaceholder: 'Optional API key',
    endpointPlaceholder: 'http://localhost:8080 (required)',
  },
};

const DEFAULT_FORM_DATA: ProviderFormData = {
  provider_name: '',
  provider_type: 'openai',
  api_key: '',
  api_endpoint: '',
  model_name: 'gpt-3.5-turbo',
  is_default: false,
};

// DataGrid column definitions
const getColumns = (
  onEdit: (provider: LLMProvider) => void,
  onDelete: (provider: LLMProvider) => void
): GridColDef<LLMProvider>[] => [
  { field: 'provider_name', headerName: 'Provider Name', flex: 1, minWidth: 150 },
  {
    field: 'provider_type',
    headerName: 'Type',
    width: 120,
    valueGetter: (value: LLMProvider['provider_type']) => PROVIDER_INFO[value].name,
  },
  { field: 'model_name', headerName: 'Model', flex: 1, minWidth: 150 },
  {
    field: 'is_default',
    headerName: 'Default',
    width: 100,
    renderCell: (params: GridRenderCellParams<LLMProvider>) => (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        {params.value ? <Chip label="Default" size="small" color="primary" /> : null}
      </Box>
    ),
  },
  {
    field: 'actions',
    headerName: 'Actions',
    width: 160,
    sortable: false,
    renderCell: (params: GridRenderCellParams<LLMProvider>) => (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <ButtonGroup size="small">
          <Button onClick={() => onEdit(params.row)}>Edit</Button>
          <Button color="error" onClick={() => onDelete(params.row)}>Delete</Button>
        </ButtonGroup>
      </Box>
    ),
  },
];

// Provider Dialog Component - handles both Add and Edit modes
interface ProviderDialogProps {
  open: boolean;
  onClose: () => void;
  provider?: LLMProvider | null;
  onSuccess: () => void;
}

function ProviderDialog({ open, onClose, provider, onSuccess }: ProviderDialogProps) {
  const isEdit = Boolean(provider);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [connectionTested, setConnectionTested] = useState(isEdit);
  const { success, error: showError } = useMuiToast();

  const { control, handleSubmit, watch, setValue, reset } = useForm<ProviderFormData>({
    defaultValues: DEFAULT_FORM_DATA,
  });

  const providerType = watch('provider_type');
  const apiKey = watch('api_key');
  const apiKeyChanged = isEdit && Boolean(apiKey && apiKey !== '••••••••');

  // Options for select elements
  const providerTypeOptions = Object.entries(PROVIDER_INFO).map(([key, info]) => ({
    id: key,
    label: info.name,
  }));

  const modelOptions = PROVIDER_MODELS[providerType].map((model) => ({
    id: model.value,
    label: model.label,
  }));

  // Reset form when dialog opens with new provider
  const handleDialogEnter = () => {
    if (provider) {
      reset({
        provider_name: provider.provider_name,
        provider_type: provider.provider_type,
        api_key: '••••••••',
        api_endpoint: provider.api_endpoint || '',
        model_name: provider.model_name,
        is_default: provider.is_default,
      });
      setConnectionTested(true);
    } else {
      reset(DEFAULT_FORM_DATA);
      setConnectionTested(false);
    }
  };

  // Auto-detect provider type from API key
  const handleApiKeyChange = (value: string) => {
    if (value && value !== '••••••••') {
      if (value.startsWith('sk-ant-')) {
        setValue('provider_type', 'anthropic');
        setValue('model_name', 'claude-3-sonnet-20240229');
      } else if (value.startsWith('sk-')) {
        setValue('provider_type', 'openai');
        setValue('model_name', 'gpt-3.5-turbo');
      } else if (value.startsWith('AIza')) {
        setValue('provider_type', 'google');
        setValue('model_name', 'gemini-pro');
      }
      setConnectionTested(false);
    }
  };

  const testConnection = async (formData: ProviderFormData) => {
    setIsTesting(true);
    try {
      const response = await fetch('/api/llm-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (response.ok) {
        success('Connection test successful!');
        setConnectionTested(true);
      } else {
        showError(data.message || 'Connection test failed');
      }
    } catch {
      showError('Network error. Please check your connection.');
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (formData: ProviderFormData) => {
    if (!connectionTested) {
      showError('Please test the connection before saving');
      return;
    }
    setIsSaving(true);
    try {
      const url = isEdit ? `/api/llm-providers/${provider!.id}` : '/api/llm-providers';
      const method = isEdit ? 'PUT' : 'POST';

      // For edit, only send changed fields
      const body = isEdit
        ? {
            provider_name: formData.provider_name,
            model_name: formData.model_name,
            is_default: formData.is_default || false,
            ...(formData.api_key !== '••••••••' && { api_key: formData.api_key }),
            ...(formData.api_endpoint && { api_endpoint: formData.api_endpoint }),
          }
        : formData;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.ok) {
        success(`LLM provider ${isEdit ? 'updated' : 'added'} successfully`);
        onClose();
        onSuccess();
      } else {
        showError(data.error || `Failed to ${isEdit ? 'update' : 'add'} provider`);
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      disableRestoreFocus
      slotProps={{ transition: { onEnter: handleDialogEnter } }}
    >
      <DialogTitle>{isEdit ? 'Edit' : 'Add'} LLM Provider</DialogTitle>
      <DialogContent>
        <DialogContentText mb={2}>
          {isEdit ? 'Update provider configuration' : 'Configure a new AI provider for generating email replies'}
        </DialogContentText>
        <Stack>
          <TextFieldElement
            name="provider_name"
            control={control}
            label="Provider Name"
            placeholder={isEdit ? undefined : 'e.g., Work OpenAI'}
          />
          <PasswordElement
            name="api_key"
            control={control}
            label="API Key"
            placeholder={isEdit ? 'Leave blank to keep current key' : PROVIDER_INFO[providerType].keyPlaceholder}
            helperText={isEdit ? undefined : 'Your API key will be encrypted and stored securely'}
            onChange={(e) => handleApiKeyChange(e.target.value)}
          />
          {isEdit ? (
            <TextField label="Provider Type" value={PROVIDER_INFO[providerType].name} disabled />
          ) : (
            <SelectElement
              name="provider_type"
              control={control}
              label="Provider Type"
              options={providerTypeOptions}
              onChange={(newType) => {
                const type = newType as ProviderFormData['provider_type'];
                setValue('model_name', PROVIDER_MODELS[type][0].value);
                setConnectionTested(false);
              }}
            />
          )}
          <SelectElement
            name="model_name"
            control={control}
            label="Model"
            options={modelOptions}
            onChange={() => setConnectionTested(false)}
          />
          <TextFieldElement
            name="api_endpoint"
            control={control}
            label={isEdit ? 'API Endpoint' : 'API Endpoint (Optional)'}
            placeholder={PROVIDER_INFO[providerType].endpointPlaceholder}
          />
          <SwitchElement
            name="is_default"
            control={control}
            label="Set as default provider"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {(!isEdit || (apiKeyChanged && !connectionTested)) && (
          <Button
            variant="outlined"
            onClick={handleSubmit(testConnection)}
            loading={isTesting}
            disabled={!apiKey}
          >
            {isEdit ? 'Test New Key' : 'Test Connection'}
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleSubmit(onSubmit)}
          loading={isSaving}
          disabled={!connectionTested || (apiKeyChanged && !connectionTested)}
        >
          {isEdit ? 'Save Changes' : 'Add Provider'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MuiLLMProvidersPage() {
  usePageTitle('LLM Providers');
  const { user, signOut } = useAuth();
  // Responsive - DataGrid needs conditional render, not CSS hide
  const isMobile = useMediaQuery('(max-width:899px)');

  // Data fetching
  const { data: providers, error, isLoading } = useSWR<LLMProvider[]>('/api/llm-providers');

  // Toast notifications
  const { success, error: showError } = useMuiToast();

  // Confirmation dialog
  const showConfirm = useConfirm();

  // Dialog state - unified for add/edit
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null);

  const openAddDialog = () => {
    setSelectedProvider(null);
    setDialogOpen(true);
  };

  const openEditDialog = (provider: LLMProvider) => {
    setSelectedProvider(provider);
    setDialogOpen(true);
  };

  const handleDeleteClick = (provider: LLMProvider) => {
    showConfirm({
      title: 'Delete LLM Provider',
      description: `Are you sure you want to delete ${provider.provider_name}? This action cannot be undone.`,
      confirmationText: 'Delete',
      onConfirm: async () => {
        const response = await fetch(`/api/llm-providers/${provider.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (response.ok) {
          success('LLM provider deleted successfully');
          mutate('/api/llm-providers');
        } else {
          const data = await response.json();
          showError(data.error || 'Failed to delete provider');
        }
      },
    });
  };

  // Show nothing while loading auth - protected layout handles redirect
  if (!user) return null;

  if (error) {
    return <Alert severity="error">Failed to load LLM providers. Please try again later.</Alert>;
  }

  return (
    <MuiAuthenticatedLayout user={user} onSignOut={signOut}>
      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <div>
          <Typography variant="h4">
            LLM Providers
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure AI providers for generating email replies
          </Typography>
        </div>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAddDialog}>
          Add Provider
        </Button>
      </Box>

      {/* Loading State */}
      {isLoading && (
        <Paper>
          <Skeleton variant="rectangular" height={52} />
          <Skeleton variant="rectangular" height={52} sx={{ mt: 0.5 }} />
          <Skeleton variant="rectangular" height={52} sx={{ mt: 0.5 }} />
        </Paper>
      )}

      {/* Empty State */}
      {!isLoading && providers?.length === 0 && (
        <Card>
          <CardContent sx={{ py: 4, textAlign: 'center' }}>
            <AddIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography color="text.secondary" mb={2}>
              No LLM providers configured yet
            </Typography>
            <Button variant="contained" onClick={openAddDialog}>
              Add Provider
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Providers List - List on mobile, DataGrid on desktop */}
      {!isLoading && providers && providers.length > 0 && (
        isMobile ? (
          <Paper>
            <List disablePadding>
              {providers.map((provider, index) => (
                <ListItem
                  key={provider.id}
                  divider={index < providers.length - 1}
                  secondaryAction={
                    <>
                      <IconButton onClick={() => openEditDialog(provider)}>
                        <EditIcon />
                      </IconButton>
                      <IconButton edge="end" onClick={() => handleDeleteClick(provider)}>
                        <DeleteIcon color="error" />
                      </IconButton>
                    </>
                  }
                  >
                    <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {provider.provider_name}
                        {provider.is_default && <Chip label="Default" size="small" color="primary" />}
                      </Box>
                    }
                    secondary={`${PROVIDER_INFO[provider.provider_type].name} • ${provider.model_name}`}
                  />
                  </ListItem>
              ))}
            </List>
          </Paper>
        ) : (
          <Paper>
            <DataGrid
              rows={providers}
              columns={getColumns(openEditDialog, handleDeleteClick)}
              autoHeight
              disableRowSelectionOnClick
              hideFooter={providers.length <= 10}
              sx={{ border: 0 }}
            />
          </Paper>
        )
      )}

      {/* Provider Dialog - handles both Add and Edit */}
      <ProviderDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        provider={selectedProvider}
        onSuccess={() => mutate('/api/llm-providers')}
      />
    </MuiAuthenticatedLayout>
  );
}
