'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import { useMemo } from 'react';
import Link from 'next/link';
import { EmailActionType } from '../../../server/src/types/email-action-tracking';
import { RelationshipType } from '../../../server/src/lib/relationships/types';

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

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch recent actions');
  }
  return res.json();
};

// Action categories for display
type ActionCategory = 'Drafted' | 'Spam' | 'Moved' | 'No Action';

// Map actions to categories and labels
function getActionInfo(actionTaken: string): {
  category: ActionCategory;
  label: string;
  color: string;
} {
  const label = EmailActionType.LABELS[actionTaken] || actionTaken;

  if (EmailActionType.isDraftAction(actionTaken)) {
    return {
      category: 'Drafted',
      label,
      color: 'bg-blue-500 hover:bg-blue-600'
    };
  }

  if (EmailActionType.isSpamAction(actionTaken)) {
    return {
      category: 'Spam',
      label,
      color: 'bg-red-500 hover:bg-red-600'
    };
  }

  if (EmailActionType.isMovedAction(actionTaken)) {
    return {
      category: 'Moved',
      label,
      color: 'bg-green-500 hover:bg-green-600'
    };
  }

  if (EmailActionType.isKeepInInbox(actionTaken)) {
    return {
      category: 'No Action',
      label,
      color: 'bg-yellow-500 hover:bg-yellow-600'
    };
  }

  // Unknown/No Action (includes MANUALLY_HANDLED, PENDING, TRAINING, etc.)
  return {
    category: 'No Action',
    label,
    color: 'bg-gray-500 hover:bg-gray-600'
  };
}

// Generate consistent color for email address
function getEmailColor(email: string): string {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-yellow-500',
    'bg-green-500',
    'bg-teal-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-purple-500',
    'bg-pink-500',
  ];

  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

interface RecentActionsTableProps {
  lookBackControls?: React.ReactNode;
}

export function RecentActionsTable({ lookBackControls }: RecentActionsTableProps) {
  const { data, error, isLoading } = useSWR<RecentActionsData>(
    `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/recent-actions?limit=20`,
    fetcher,
    {
      refreshInterval: 30000, // Auto-refresh every 30 seconds
      revalidateOnFocus: true,
    }
  );

  // Get unique email accounts for legend (must be before conditionals)
  const uniqueEmails = useMemo(() => {
    if (!data || !data.actions) return [];
    const emails = Array.from(new Set(data.actions.map(a => a.emailAccount)));
    return emails.map(email => ({
      email,
      color: getEmailColor(email)
    }));
  }, [data]);

  if (error) {
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Emails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">Failed to load recent emails</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Emails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Loading recent emails...</div>
        </CardContent>
      </Card>
    );
  }

  if (data.actions.length === 0) {
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Emails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-center py-8">
            No emails processed yet. Start processing emails to see activity here.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">Recent Emails</CardTitle>

          {/* Look Back Controls */}
          {lookBackControls && (
            <div className="flex items-center gap-2">
              {lookBackControls}
            </div>
          )}

          {/* Email Account Legend - Right Aligned */}
          <div className="flex flex-wrap gap-3 justify-end ml-auto">
            {uniqueEmails.map(({ email, color }) => (
              <div key={email} className="flex items-center gap-2 text-xs">
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <span className="text-muted-foreground">{email}</span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1.5 px-2 font-medium">Time</th>
                <th className="text-left py-1.5 px-2 font-medium">From</th>
                <th className="text-left py-1.5 px-2 font-medium">Relationship</th>
                <th className="text-left py-1.5 px-2 font-medium">Subject</th>
                <th className="text-left py-1.5 px-2 font-medium">Action</th>
                <th className="text-center py-1.5 px-2 font-medium">Account</th>
                <th className="text-left py-1.5 px-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.actions.map((action) => {
                const actionInfo = getActionInfo(action.actionTaken);
                const emailColor = getEmailColor(action.emailAccount);
                const relationshipColor = RelationshipType.COLORS[action.relationship] || RelationshipType.COLORS.unknown;
                const relationshipLabel = RelationshipType.LABELS[action.relationship] || RelationshipType.LABELS.unknown;

                return (
                  <tr key={action.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-1.5 px-2 whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNow(new Date(action.updatedAt), { addSuffix: true })}
                    </td>
                    <td className="py-1.5 px-2 max-w-[200px] truncate" title={action.senderEmail || 'Unknown'}>
                      {action.senderName || action.senderEmail || '(Unknown)'}
                    </td>
                    <td className="py-1.5 px-2">
                      <Badge className={`${relationshipColor} text-white text-xs px-1.5 py-0`}>
                        {relationshipLabel}
                      </Badge>
                    </td>
                    <td className="py-1.5 px-2 max-w-xs truncate" title={action.subject}>
                      {action.subject}
                    </td>
                    <td className="py-1.5 px-2">
                      <Badge className={`${actionInfo.color} text-white text-xs px-1.5 py-0`}>
                        {actionInfo.label}
                      </Badge>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <div className="flex justify-center">
                        <div
                          className={`w-3 h-3 rounded-full ${emailColor}`}
                          title={action.emailAccount}
                        />
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      <Link
                        href={`/inbox?emailAccountId=${action.emailAccountId}&messageId=${encodeURIComponent(action.messageId)}`}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.total > 20 && (
          <div className="text-xs text-muted-foreground text-center mt-4">
            Showing 20 of {data.total} total actions
          </div>
        )}
      </CardContent>
    </Card>
  );
}
