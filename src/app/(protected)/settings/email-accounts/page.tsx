'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useForm } from 'react-hook-form';
import { TextFieldElement, SwitchElement, PasswordElement } from 'react-hook-form-mui';
import {
  Box,
  Card,
  CardContent,
  Paper,
  Typography,
  Button,
  ButtonGroup,
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
  Divider,
  Switch,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import MailIcon from '@mui/icons-material/Mail';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SyncIcon from '@mui/icons-material/Sync';
import { FcGoogle } from 'react-icons/fc';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { useConfirm } from '@/components/confirm-dialog';
import { EmailAccountResponse } from '@/types/email-account';
import { useAuth } from '@/lib/auth-context';
import { MuiAuthenticatedLayout } from '@/components/mui';

// Form data interface
interface AccountFormData {
  email_address: string;
  imap_username: string;
  imap_password: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
}

interface CredentialsFormData {
  imap_username: string;
  imap_password: string;
  imap_host: string;
  imap_port: number;
}

const DEFAULT_FORM_DATA: AccountFormData = {
  email_address: '',
  imap_username: '',
  imap_password: '',
  imap_host: 'localhost',
  imap_port: 1143,
  imap_secure: false,
};

// Format last sync date
const formatLastSync = (lastSync: string | null): string => {
  if (!lastSync) return 'Never';
  return new Date(lastSync).toLocaleString();
};

// DataGrid column definitions
const getColumns = (
  onEdit: (account: EmailAccountResponse) => void,
  onDelete: (account: EmailAccountResponse) => void,
  onTest: (account: EmailAccountResponse) => void,
  onReconnect: (account: EmailAccountResponse) => void,
  onToggleMonitoring: (account: EmailAccountResponse, enabled: boolean) => void
): GridColDef<EmailAccountResponse>[] => [
  {
    field: 'email_address',
    headerName: 'Email',
    flex: 1,
    minWidth: 200,
    renderCell: (params: GridRenderCellParams<EmailAccountResponse>) => (
      <Box>
        <Typography variant="body2">{params.value}</Typography>
        {params.row.oauth_provider && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <FcGoogle style={{ fontSize: 12 }} />
            <Typography variant="caption" color="text.secondary">
              OAuth
            </Typography>
          </Box>
        )}
      </Box>
    ),
  },
  {
    field: 'imap_host',
    headerName: 'Server',
    flex: 1,
    minWidth: 150,
    valueGetter: (value: string, row: EmailAccountResponse) => `${value}:${row.imap_port}`,
  },
  {
    field: 'monitoring_enabled',
    headerName: 'Monitoring',
    width: 130,
    renderCell: (params: GridRenderCellParams<EmailAccountResponse>) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {params.value ? (
          <VisibilityIcon fontSize="small" color="primary" />
        ) : (
          <VisibilityOffIcon fontSize="small" color="disabled" />
        )}
        <Switch
          checked={params.value || false}
          onChange={(e) => onToggleMonitoring(params.row, e.target.checked)}
          size="small"
        />
      </Box>
    ),
  },
  {
    field: 'last_sync',
    headerName: 'Last Sync',
    flex: 1,
    minWidth: 150,
    valueGetter: (value: string | null) => formatLastSync(value),
  },
  {
    field: 'actions',
    headerName: 'Actions',
    width: 180,
    sortable: false,
    renderCell: (params: GridRenderCellParams<EmailAccountResponse>) => (
      <ButtonGroup size="small" sx={{ my: 'auto' }}>
        {params.row.oauth_provider ? (
          <Button onClick={() => onReconnect(params.row)}>Reconnect</Button>
        ) : (
          <>
            <Button onClick={() => onTest(params.row)}>Test</Button>
            <Button onClick={() => onEdit(params.row)}>Edit</Button>
          </>
        )}
        <Button color="error" onClick={() => onDelete(params.row)}>Delete</Button>
      </ButtonGroup>
    ),
  },
];

// Add Account Dialog Component
interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function AddAccountDialog({ open, onClose, onSuccess }: AddAccountDialogProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const { success, error: showError } = useMuiToast();

  const { control, handleSubmit, watch, setValue, reset } = useForm<AccountFormData>({
    defaultValues: DEFAULT_FORM_DATA,
  });

  const emailAddress = watch('email_address');

  // Reset form when dialog opens
  const handleDialogEnter = () => {
    reset(DEFAULT_FORM_DATA);
    setConnectionTested(false);
  };

  // Auto-detect provider settings
  const handleEmailChange = (email: string) => {
    setValue('imap_username', email);

    if (email.endsWith('@gmail.com')) {
      setValue('imap_host', 'imap.gmail.com');
      setValue('imap_port', 993);
      setValue('imap_secure', true);
    } else if (email.includes('@outlook') || email.includes('@hotmail')) {
      setValue('imap_host', 'outlook.office365.com');
      setValue('imap_port', 993);
      setValue('imap_secure', true);
    } else if (email.includes('@yahoo')) {
      setValue('imap_host', 'imap.mail.yahoo.com');
      setValue('imap_port', 993);
      setValue('imap_secure', true);
    } else if (email.includes('@icloud.com') || email.includes('@me.com') || email.includes('@mac.com')) {
      setValue('imap_host', 'imap.mail.me.com');
      setValue('imap_port', 993);
      setValue('imap_secure', true);
    }
    setConnectionTested(false);
  };

  const handleConnectOAuth = async () => {
    try {
      const response = await fetch('/api/oauth-direct/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: 'google' }),
      });

      if (!response.ok) {
        const error = await response.json();
        showError(error.error || 'Failed to start OAuth flow');
        return;
      }

      const { authUrl } = await response.json();
      window.location.href = authUrl;
    } catch {
      showError('Failed to connect. Please try again.');
    }
  };

  const testConnection = async (formData: AccountFormData) => {
    setIsTesting(true);
    try {
      const response = await fetch('/api/email-accounts/test', {
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

  const onSubmit = async (formData: AccountFormData) => {
    if (!connectionTested) {
      showError('Please test the connection before saving');
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch('/api/email-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (response.ok) {
        success('Email account added successfully');
        onClose();
        onSuccess();
      } else {
        showError(data.error || 'Failed to add email account');
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
      <DialogTitle>Add Email Account</DialogTitle>
      <DialogContent>
        <DialogContentText mb={2}>
          Connect your email account to enable AI-powered email assistance
        </DialogContentText>

        {/* OAuth Section */}
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Connect with OAuth (Recommended)
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" mb={2}>
            The most secure way to connect your email account
          </Typography>
          <Button
            variant="outlined"
            fullWidth
            onClick={handleConnectOAuth}
            startIcon={<FcGoogle />}
          >
            Connect with Google
          </Button>
        </Box>

        <Divider sx={{ my: 3 }}>
          <Typography variant="caption" color="text.secondary">
            Or connect manually
          </Typography>
        </Divider>

        <Stack>
          <TextFieldElement
            name="email_address"
            control={control}
            label="Email Address"
            type="email"
            placeholder="user@example.com"
            helperText="The email address you want to connect"
            onChange={(e) => handleEmailChange(e.target.value)}
          />
          <TextFieldElement
            name="imap_username"
            control={control}
            label="IMAP Username"
            placeholder="Usually your email address"
          />
          <PasswordElement
            name="imap_password"
            control={control}
            label="Password"
            placeholder="Your email password"
            helperText="For Gmail, usually an app-specific password"
          />
          <TextFieldElement
            name="imap_host"
            control={control}
            label="IMAP Server"
            placeholder="imap.gmail.com"
          />
          <TextFieldElement
            name="imap_port"
            control={control}
            label="IMAP Port"
            type="number"
            placeholder="993"
          />
          <SwitchElement
            name="imap_secure"
            control={control}
            label="Use SSL/TLS"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="outlined"
          onClick={handleSubmit(testConnection)}
          loading={isTesting}
          disabled={!emailAddress}
        >
          Test Connection
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit(onSubmit)}
          loading={isSaving}
          disabled={!connectionTested}
        >
          Add Account
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Edit Credentials Dialog Component
interface EditCredentialsDialogProps {
  open: boolean;
  onClose: () => void;
  account: EmailAccountResponse | null;
  onSuccess: () => void;
}

function EditCredentialsDialog({ open, onClose, account, onSuccess }: EditCredentialsDialogProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const { success, error: showError } = useMuiToast();

  const { control, handleSubmit, reset } = useForm<CredentialsFormData>({
    defaultValues: {
      imap_username: '',
      imap_password: '',
      imap_host: '',
      imap_port: 993,
    },
  });

  // Reset form when dialog opens with account
  const handleDialogEnter = () => {
    if (account) {
      reset({
        imap_username: account.imap_username,
        imap_password: '',
        imap_host: account.imap_host,
        imap_port: account.imap_port,
      });
      setConnectionTested(false);
    }
  };

  const testConnection = async (formData: CredentialsFormData) => {
    if (!account) return;
    setIsTesting(true);
    try {
      const response = await fetch('/api/email-accounts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email_address: account.email_address,
          ...formData,
          imap_secure: account.imap_secure,
        }),
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

  const onSubmit = async (formData: CredentialsFormData) => {
    if (!account) return;
    if (!connectionTested) {
      showError('Please test the connection before saving');
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(`/api/email-accounts/${account.id}/update-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (response.ok) {
        success('Email account credentials updated successfully');
        onClose();
        onSuccess();
      } else {
        showError(data.error || 'Failed to update credentials');
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
      <DialogTitle>Edit Email Account</DialogTitle>
      <DialogContent>
        <DialogContentText mb={2}>
          Update your email account settings. You&apos;ll need to re-enter your password.
        </DialogContentText>
        <Stack>
          <TextFieldElement
            name="imap_username"
            control={control}
            label="IMAP Username"
          />
          <PasswordElement
            name="imap_password"
            control={control}
            label="Password"
            placeholder="Enter new password"
            helperText="Re-enter your password to save changes"
          />
          <TextFieldElement
            name="imap_host"
            control={control}
            label="IMAP Server"
          />
          <TextFieldElement
            name="imap_port"
            control={control}
            label="IMAP Port"
            type="number"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="outlined"
          onClick={handleSubmit(testConnection)}
          loading={isTesting}
        >
          Test Connection
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit(onSubmit)}
          loading={isSaving}
          disabled={!connectionTested}
        >
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MuiEmailAccountsPage() {
  const { user, signOut } = useAuth();
  // Responsive - DataGrid needs conditional render, not CSS hide
  const isMobile = useMediaQuery('(max-width:899px)');

  // Data fetching
  const { data: accounts, error, isLoading } = useSWR<EmailAccountResponse[]>('/api/email-accounts');

  // Toast notifications
  const { success, error: showError } = useMuiToast();

  // Confirmation dialog
  const showConfirm = useConfirm();

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<EmailAccountResponse | null>(null);

  const openEditDialog = (account: EmailAccountResponse) => {
    setSelectedAccount(account);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (account: EmailAccountResponse) => {
    showConfirm({
      title: 'Delete Email Account',
      description: `Are you sure you want to delete ${account.email_address}? This action cannot be undone.`,
      confirmationText: 'Delete',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/email-accounts/${account.id}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          if (response.ok) {
            success('Email account deleted successfully');
            mutate('/api/email-accounts');
          } else {
            const data = await response.json();
            showError(data.error || 'Failed to delete account');
          }
        } catch {
          showError('Network error. Please try again.');
        }
      },
    });
  };

  const handleTestClick = async (account: EmailAccountResponse) => {
    try {
      const response = await fetch(`/api/email-accounts/${account.id}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        success(data.message || 'Connection test successful!');
      } else {
        showError(data.error || 'Connection test failed');
      }
    } catch {
      showError('Network error. Please try again.');
    }
  };

  const handleReconnectClick = async (account: EmailAccountResponse) => {
    try {
      const response = await fetch('/api/oauth-direct/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: account.oauth_provider || 'google' }),
      });
      if (!response.ok) {
        const err = await response.json();
        showError(err.error || 'Failed to start OAuth flow');
        return;
      }
      const { authUrl } = await response.json();
      window.location.href = authUrl;
    } catch {
      showError('Failed to start OAuth flow');
    }
  };

  const handleToggleMonitoring = async (account: EmailAccountResponse, enabled: boolean) => {
    try {
      const response = await fetch(`/api/email-accounts/${account.id}/monitoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });
      if (response.ok) {
        success(enabled ? 'Monitoring enabled' : 'Monitoring disabled');
        mutate('/api/email-accounts');
      } else {
        const data = await response.json();
        showError(data.error || 'Failed to toggle monitoring');
      }
    } catch {
      showError('Network error. Please try again.');
    }
  };

  // Show nothing while loading auth - protected layout handles redirect
  if (!user) return null;

  if (error) {
    return <Alert severity="error">Failed to load email accounts. Please try again later.</Alert>;
  }

  return (
    <MuiAuthenticatedLayout user={user} onSignOut={signOut}>
      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <div>
          <Typography variant="h4">Email Accounts</Typography>
          <Typography variant="body2" color="text.secondary">
            Connect your email accounts to enable AI-powered email assistance
          </Typography>
        </div>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddDialogOpen(true)}>
          Add Account
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
      {!isLoading && accounts?.length === 0 && (
        <Card>
          <CardContent sx={{ py: 4, textAlign: 'center' }}>
            <MailIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography color="text.secondary" mb={2}>
              No email accounts connected yet
            </Typography>
            <Button variant="contained" onClick={() => setAddDialogOpen(true)}>
              Add Account
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Accounts List - List on mobile, DataGrid on desktop */}
      {!isLoading && accounts && accounts.length > 0 && (
        isMobile ? (
          <Paper>
            <List disablePadding>
              {accounts.map((account, index) => (
                <ListItem
                  key={account.id}
                  divider={index < accounts.length - 1}
                  secondaryAction={
                    <Box>
                      {account.oauth_provider ? (
                        <IconButton onClick={() => handleReconnectClick(account)} title="Reconnect">
                          <SyncIcon />
                        </IconButton>
                      ) : (
                        <>
                          <IconButton onClick={() => handleTestClick(account)} title="Test Connection">
                            <PlayArrowIcon />
                          </IconButton>
                          <IconButton onClick={() => openEditDialog(account)} title="Edit">
                            <EditIcon />
                          </IconButton>
                        </>
                      )}
                      <IconButton edge="end" onClick={() => handleDeleteClick(account)} title="Delete">
                        <DeleteIcon color="error" />
                      </IconButton>
                    </Box>
                  }
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        {account.email_address}
                        {account.oauth_provider && (
                          <Chip
                            icon={<FcGoogle />}
                            label="OAuth"
                            size="small"
                            variant="outlined"
                          />
                        )}
                        {account.monitoring_enabled && (
                          <Chip
                            icon={<VisibilityIcon />}
                            label="Monitoring"
                            size="small"
                            color="primary"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <>
                        {account.imap_host}:{account.imap_port}
                        <br />
                        Last sync: {formatLastSync(account.last_sync)}
                      </>
                    }
                    slotProps={{
                      primary: { component: 'div' },
                      secondary: { component: 'div' },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        ) : (
          <Paper>
            <DataGrid
              rows={accounts}
              columns={getColumns(openEditDialog, handleDeleteClick, handleTestClick, handleReconnectClick, handleToggleMonitoring)}
              autoHeight
              disableRowSelectionOnClick
              hideFooter={accounts.length <= 10}
              sx={{ border: 0 }}
            />
          </Paper>
        )
      )}

      {/* Add Account Dialog */}
      <AddAccountDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSuccess={() => mutate('/api/email-accounts')}
      />

      {/* Edit Credentials Dialog */}
      <EditCredentialsDialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        account={selectedAccount}
        onSuccess={() => mutate('/api/email-accounts')}
      />
    </MuiAuthenticatedLayout>
  );
}
