'use client';

import { useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Skeleton,
  Alert,
  Chip,
  Link as MuiLink,
  useMediaQuery,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import Link from 'next/link';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import { EmailActionType } from '../../../../../../server/src/types/email-action-tracking';
import { RelationshipType } from '../../../../../../server/src/lib/relationships/types';
import { RelationshipSelector } from './relationship-selector';
import { ActionSelector } from './action-selector';

interface RecentAction {
  id: string;
  messageId: string;
  actionTaken: string;
  subject: string;
  senderEmail?: string;
  senderName?: string;
  destinationFolder?: string;
  updatedAt: string;
  emailAccountId: string;
  emailAccount: string;
  relationship: string;
}

interface RecentActionsData {
  actions: RecentAction[];
  total: number;
}

// Generate consistent color for email address (MUI-compatible colors)
const EMAIL_COLORS = [
  '#ef5350', // red[400]
  '#ff9800', // orange[500]
  '#ffca28', // amber[400]
  '#66bb6a', // green[400]
  '#26a69a', // teal[400]
  '#42a5f5', // blue[400]
  '#5c6bc0', // indigo[400]
  '#ab47bc', // purple[400]
  '#ec407a', // pink[400]
];

function getEmailColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return EMAIL_COLORS[Math.abs(hash) % EMAIL_COLORS.length];
}

// MUI-friendly hex colors for relationship types
const RELATIONSHIP_COLORS: Record<string, string> = {
  [RelationshipType.SPOUSE]: '#ec407a',
  [RelationshipType.FAMILY]: '#ab47bc',
  [RelationshipType.COLLEAGUE]: '#42a5f5',
  [RelationshipType.FRIENDS]: '#66bb6a',
  [RelationshipType.EXTERNAL]: '#9e9e9e',
  [RelationshipType.SPAM]: '#ef5350',
  unknown: '#78909c',
};

// DataGrid column definitions - extracted outside component for better performance
const getColumns = (): GridColDef<RecentAction>[] => [
  {
    field: 'updatedAt',
    headerName: 'Time',
    width: 120,
    valueGetter: (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true }),
  },
  {
    field: 'senderName',
    headerName: 'From',
    flex: 1,
    minWidth: 150,
    valueGetter: (value: string, row: RecentAction) => value || row.senderEmail || '(Unknown)',
  },
  {
    field: 'relationship',
    headerName: 'Relationship',
    width: 120,
    renderCell: (params: GridRenderCellParams<RecentAction>) => {
      if (params.row.senderEmail) {
        return (
          <RelationshipSelector
            emailAddress={params.row.senderEmail}
            currentRelationship={params.row.relationship}
          />
        );
      }
      return (
        <Chip
          label={RelationshipType.LABELS.unknown}
          size="small"
          sx={{
            backgroundColor: RELATIONSHIP_COLORS.unknown,
            color: 'white',
          }}
        />
      );
    },
  },
  {
    field: 'subject',
    headerName: 'Subject',
    flex: 2,
    minWidth: 200,
  },
  {
    field: 'actionTaken',
    headerName: 'Action',
    width: 130,
    renderCell: (params: GridRenderCellParams<RecentAction>) => {
      if (params.row.senderEmail) {
        return (
          <ActionSelector
            emailAddress={params.row.senderEmail}
            currentAction={params.row.actionTaken}
            relationshipType={params.row.relationship}
          />
        );
      }
      const actionColor = EmailActionType.COLORS[params.row.actionTaken] || '#71717a';
      const actionLabel = EmailActionType.LABELS[params.row.actionTaken] || params.row.actionTaken;
      return (
        <Chip
          label={actionLabel}
          size="small"
          sx={{ backgroundColor: actionColor, color: 'white' }}
        />
      );
    },
  },
  {
    field: 'emailAccount',
    headerName: 'Account',
    width: 70,
    align: 'center',
    headerAlign: 'center',
    renderCell: (params: GridRenderCellParams<RecentAction>) => (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: getEmailColor(params.row.emailAccount),
          }}
          title={params.row.emailAccount}
        />
      </Box>
    ),
  },
  {
    field: 'actions',
    headerName: 'Details',
    width: 80,
    sortable: false,
    renderCell: (params: GridRenderCellParams<RecentAction>) => (
      <MuiLink
        component={Link}
        href={`/poc/mui-inbox?emailAccountId=${params.row.emailAccountId}&messageId=${encodeURIComponent(params.row.messageId)}`}
        underline="hover"
      >
        View
      </MuiLink>
    ),
  },
];

export function RecentActionsTable() {
  // Responsive - DataGrid needs conditional render, not CSS hide
  const isMobile = useMediaQuery('(max-width:899px)');

  const { data, error, isLoading } = useSWR<RecentActionsData>(
    '/api/dashboard/recent-actions?limit=20',
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
    }
  );

  // Get unique email accounts for legend
  const uniqueEmails = useMemo(() => {
    if (!data || !data.actions) return [];
    const emails = Array.from(new Set(data.actions.map((a) => a.emailAccount)));
    return emails.map((email) => ({
      email,
      color: getEmailColor(email),
    }));
  }, [data]);

  const columns = useMemo(() => getColumns(), []);

  if (error) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Recent Emails
        </Typography>
        <Paper sx={{ p: 3 }}>
          <Alert severity="error">Failed to load recent emails</Alert>
        </Paper>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Recent Emails
        </Typography>
        <Paper>
          <Skeleton variant="rectangular" height={52} />
          <Skeleton variant="rectangular" height={52} sx={{ mt: 0.5 }} />
          <Skeleton variant="rectangular" height={52} sx={{ mt: 0.5 }} />
        </Paper>
      </Box>
    );
  }

  if (!data || data.actions.length === 0) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Recent Emails
        </Typography>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No emails processed yet. Start processing emails to see activity here.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">Recent Emails</Typography>

        {/* Email Account Legend */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {uniqueEmails.map(({ email, color }) => (
            <Box key={email} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: color,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {email}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Data display - List on mobile, DataGrid on desktop */}
      {isMobile ? (
        <Paper>
          <List disablePadding>
            {data.actions.map((action, index) => {
              const actionColor = EmailActionType.COLORS[action.actionTaken] || '#71717a';
              const actionLabel = EmailActionType.LABELS[action.actionTaken] || action.actionTaken;
              return (
                <ListItem
                  key={action.id}
                  divider={index < data.actions.length - 1}
                  sx={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
                >
                  <ListItemText
                    primary={action.subject}
                    secondary={`${action.senderName || action.senderEmail || 'Unknown'} - ${formatDistanceToNow(new Date(action.updatedAt), { addSuffix: true })}`}
                    slotProps={{ primary: { noWrap: true } }}
                    sx={{ width: '100%' }}
                  />
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    {action.senderEmail ? (
                      <>
                        <RelationshipSelector
                          emailAddress={action.senderEmail}
                          currentRelationship={action.relationship}
                        />
                        <ActionSelector
                          emailAddress={action.senderEmail}
                          currentAction={action.actionTaken}
                          relationshipType={action.relationship}
                        />
                      </>
                    ) : (
                      <Chip
                        label={actionLabel}
                        size="small"
                        sx={{ backgroundColor: actionColor, color: 'white' }}
                      />
                    )}
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: getEmailColor(action.emailAccount),
                      }}
                      title={action.emailAccount}
                    />
                    <MuiLink
                      component={Link}
                      href={`/poc/mui-inbox?emailAccountId=${action.emailAccountId}&messageId=${encodeURIComponent(action.messageId)}`}
                      underline="hover"
                      variant="caption"
                    >
                      View
                    </MuiLink>
                  </Box>
                </ListItem>
              );
            })}
          </List>
        </Paper>
      ) : (
        <Paper>
          <DataGrid
            rows={data.actions}
            columns={columns}
            autoHeight
            disableRowSelectionOnClick
            hideFooter={data.actions.length <= 10}
            pageSizeOptions={[10, 20]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10 } },
            }}
            rowHeight={40}
            sx={{ border: 0 }}
          />
        </Paper>
      )}

      {data.total > 20 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 2 }}>
          Showing 20 of {data.total} total actions
        </Typography>
      )}
    </Box>
  );
}
