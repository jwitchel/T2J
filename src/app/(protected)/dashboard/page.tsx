'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box,
  Paper,
  Typography,
  Button,
  Switch,
  MenuItem,
  Select,
  FormControl,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Skeleton,
  Stack,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  SelectChangeEvent,
  useMediaQuery,
} from '@mui/material';
import MailIcon from '@mui/icons-material/Mail';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AddIcon from '@mui/icons-material/Add';
import Link from 'next/link';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { useAuth } from '@/lib/auth-context';
import { MuiAuthenticatedLayout } from '@/components/mui';
import { ActionsSummaryChart } from './components/actions-summary-chart';
import { RecentActionsTable } from './components/recent-actions-table';

// Types
interface EmailAccount {
  id: string;
  email_address: string;
  monitoring_enabled: boolean;
}

interface LLMProvider {
  id: string;
  provider_name: string;
  provider_type: string;
  is_default: boolean;
  is_active: boolean;
}

// Constants
const LOOKBACK_OPTIONS = [
  { value: '15min', label: '15 Minutes' },
  { value: '1hour', label: '1 Hour' },
  { value: '4hours', label: '4 Hours' },
  { value: 'today', label: 'All of Today' },
  { value: 'yesterday', label: 'Yesterday and Today' },
];

const getLookBackDate = (option: string): Date => {
  const now = new Date();

  switch (option) {
    case '15min':
      return new Date(now.getTime() - 15 * 60 * 1000);
    case '1hour':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '4hours':
      return new Date(now.getTime() - 4 * 60 * 60 * 1000);
    case 'today': {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return today;
    }
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      return yesterday;
    }
    default:
      return new Date(now.getTime() - 15 * 60 * 1000);
  }
};

const getLookBackLabel = (option: string): string => {
  switch (option) {
    case '15min':
      return '15 minutes ago';
    case '1hour':
      return '1 hour ago';
    case '4hours':
      return '4 hours ago';
    case 'today':
      return 'midnight today';
    case 'yesterday':
      return 'midnight yesterday';
    default:
      return '15 minutes ago';
  }
};

export default function MuiDashboardPage() {
  const { user, signOut } = useAuth();
  const isMobile = useMediaQuery('(max-width:899px)');
  const { success, error: showError } = useMuiToast();
  const [lookBackOption, setLookBackOption] = useState<string>('15min');
  const [lookBackDialogOpen, setLookBackDialogOpen] = useState(false);

  const {
    data: emailAccounts,
    isLoading: accountsLoading,
    mutate: mutateAccounts,
  } = useSWR<EmailAccount[]>('/api/email-accounts');

  const { data: providers, isLoading: providersLoading } = useSWR<LLMProvider[]>('/api/llm-providers');

  const defaultProvider = providers?.find((p) => p.is_default) || null;

  const handleToggleMonitoring = async (account: EmailAccount, enabled: boolean) => {
    try {
      const response = await fetch(`/api/email-accounts/${account.id}/monitoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });

      if (response.ok) {
        success(enabled ? 'Monitoring enabled' : 'Monitoring disabled');
        mutateAccounts();
      } else {
        const errorData = await response.json();
        showError(errorData.error || 'Failed to toggle monitoring');
      }
    } catch (err) {
      showError('Failed to toggle monitoring');
      console.error('Error:', err);
    }
  };

  const handleLookBackOptionChange = (event: SelectChangeEvent<string>) => {
    setLookBackOption(event.target.value);
  };

  const handleLookBack = async () => {
    setLookBackDialogOpen(false);
    try {
      const sinceDate = getLookBackDate(lookBackOption);

      const response = await fetch('/api/jobs/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'process-inbox',
          data: {
            folderName: 'INBOX',
            since: sinceDate.toISOString(),
            fanOut: true,
          },
          priority: 'high',
        }),
      });

      if (response.ok) {
        success('Look back processing queued for all monitored accounts');
      } else {
        const errorData = await response.json();
        showError(errorData.error || 'Failed to queue look back');
      }
    } catch (err) {
      showError('Failed to queue look back processing');
      console.error('Error:', err);
    }
  };

  // Show nothing while loading auth - protected layout handles redirect
  if (!user) return null;

  return (
    <MuiAuthenticatedLayout user={user} onSignOut={signOut}>
      {/* Page Header */}
      <Typography variant="h4" sx={{ mb: 4 }}>Dashboard</Typography>

      {/* Recent Actions Table - Shows first on mobile */}
      {isMobile && <Box sx={{ mb: 4 }}><RecentActionsTable /></Box>}

      {/* Analytics Section - 2 Column Layout */}
      <Stack direction={{ xs: 'column', lg: 'row' }} sx={{ mb: 4 }}>
        {/* Actions Summary Chart */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ActionsSummaryChart />
        </Box>

        {/* Account Summary */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" gutterBottom>Account Summary</Typography>
          <Paper sx={{ p: 2 }}>
            {/* Email Accounts Section */}
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <MailIcon fontSize="small" color="action" sx={{ mr: 1 }} />
              <Typography variant="body2" color="text.secondary" fontWeight="medium">
                Email Accounts
              </Typography>
            </Stack>
            {accountsLoading ? (
              <Box sx={{ mb: 2 }}>
                <Skeleton variant="rectangular" height={32} />
                <Skeleton variant="rectangular" height={32} sx={{ mt: 0.5 }} />
              </Box>
            ) : emailAccounts && emailAccounts.length > 0 ? (
              <List dense disablePadding sx={{ mb: 2 }}>
                {emailAccounts.map((account) => (
                  <ListItem key={account.id} disablePadding sx={{ py: 0.5 }}>
                    <ListItemText
                      primary={account.email_address}
                      slotProps={{ primary: { variant: 'body2' } }}
                    />
                    <Switch
                      size="small"
                      checked={account.monitoring_enabled || false}
                      onChange={(e) => handleToggleMonitoring(account, e.target.checked)}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No email accounts configured
                </Typography>
                <Button
                  component={Link}
                  href="/settings/email-accounts"
                  size="small"
                  startIcon={<AddIcon />}
                >
                  Add
                </Button>
              </Stack>
            )}

            {/* Default LLM Provider Section */}
            <ListItem disablePadding sx={{ py: 0.5 }}>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <SmartToyIcon fontSize="small" color="action" />
              </ListItemIcon>
              <ListItemText
                primary="Default LLM Provider"
                slotProps={{ primary: { variant: 'body2', color: 'text.secondary', fontWeight: 'medium' } }}
              />
              {providersLoading ? (
                <Skeleton variant="text" width={100} />
              ) : defaultProvider ? (
                <Typography variant="body2" fontWeight="medium">
                  {defaultProvider.provider_name}
                </Typography>
              ) : (
                <Button
                  component={Link}
                  href="/settings/llm-providers"
                  size="small"
                  startIcon={<AddIcon />}
                >
                  Add
                </Button>
              )}
            </ListItem>

            {/* Look Back Controls */}
            <Stack direction="row" alignItems="center" sx={{ mt: 3 }}>
              <FormControl sx={{ width: 160, mr: 1 }}>
                <Select value={lookBackOption} onChange={handleLookBackOptionChange}>
                  {LOOKBACK_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" onClick={() => setLookBackDialogOpen(true)}>
                Look Back
              </Button>
            </Stack>
          </Paper>
        </Box>
      </Stack>

      {/* Recent Actions Table - Desktop only (mobile shows above) */}
      {!isMobile && <RecentActionsTable />}

      {/* Look Back Confirmation Dialog */}
      <Dialog
        open={lookBackDialogOpen}
        onClose={() => setLookBackDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>Process Historical Emails?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This will process all emails from <strong>{getLookBackLabel(lookBackOption)}</strong> to
            present for all monitored accounts.
          </DialogContentText>
          <DialogContentText variant="body2" color="text.secondary">
            Already processed emails will be skipped automatically.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLookBackDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleLookBack}>
            Process Emails
          </Button>
        </DialogActions>
      </Dialog>
    </MuiAuthenticatedLayout>
  );
}
