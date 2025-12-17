'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import useSWR from 'swr'
import { formatDistanceToNow } from 'date-fns'
import { useMemo } from 'react'
import Link from 'next/link'
import { EmailActionType } from '../../../server/src/types/email-action-tracking'
import { RelationshipType } from '../../../server/src/lib/relationships/types'
import { RelationshipSelector } from '@/components/relationship-selector'

interface RecentAction {
  id: string
  messageId: string
  actionTaken: string
  subject: string
  senderEmail?: string
  senderName?: string
  destinationFolder?: string
  updatedAt: string
  emailAccountId: string
  emailAccount: string
  relationship: string
}

interface RecentActionsData {
  actions: RecentAction[]
  total: number
}

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error('Failed to fetch recent actions')
  }
  return res.json()
}

// Map actions to display info (label and color)
function getActionInfo(actionTaken: string): { label: string; color: string } {
  const label = EmailActionType.LABELS[actionTaken] || actionTaken

  if (EmailActionType.isDraftAction(actionTaken)) {
    return { label, color: 'bg-blue-500 hover:bg-blue-600' }
  }

  if (EmailActionType.isSpamAction(actionTaken)) {
    return { label, color: 'bg-red-500 hover:bg-red-600' }
  }

  if (EmailActionType.isMovedAction(actionTaken)) {
    return { label, color: 'bg-green-500 hover:bg-green-600' }
  }

  if (EmailActionType.isKeepInInbox(actionTaken)) {
    return { label, color: 'bg-yellow-500 hover:bg-yellow-600' }
  }

  // System actions (MANUALLY_HANDLED, PENDING, TRAINING, etc.)
  return { label, color: 'bg-gray-500 hover:bg-gray-600' }
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
  ]

  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash)
  }

  return colors[Math.abs(hash) % colors.length]
}

interface RecentActionsTableProps {
  lookBackControls?: React.ReactNode
}

export function RecentActionsTable({ lookBackControls }: RecentActionsTableProps) {
  const { data, error, isLoading } = useSWR<RecentActionsData>(
    `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/recent-actions?limit=20`,
    fetcher,
    {
      refreshInterval: 30000, // Auto-refresh every 30 seconds
      revalidateOnFocus: true,
    }
  )

  // Get unique email accounts for legend (must be before conditionals)
  const uniqueEmails = useMemo(() => {
    if (!data || !data.actions) return []
    const emails = Array.from(new Set(data.actions.map((a) => a.emailAccount)))
    return emails.map((email) => ({
      email,
      color: getEmailColor(email),
    }))
  }, [data])

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Recent Emails</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="text-red-500">Failed to load recent emails</div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Recent Emails</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="text-muted-foreground">Loading recent emails...</div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (data.actions.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Recent Emails</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="text-muted-foreground py-8 text-center">
              No emails processed yet. Start processing emails to see activity here.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Recent Emails</h2>

        {/* Look Back Controls */}
        {lookBackControls && <div className="flex items-center gap-2">{lookBackControls}</div>}

        {/* Email Account Legend - Right Aligned */}
        <div className="ml-auto flex flex-wrap justify-end gap-3">
          {uniqueEmails.map(({ email, color }) => (
            <div key={email} className="flex items-center gap-2 text-xs">
              <div className={`h-3 w-3 rounded-full ${color}`} />
              <span className="text-muted-foreground">{email}</span>
            </div>
          ))}
        </div>
      </div>
      <Card>
        <CardContent className="pt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1.5 text-left font-medium">Time</th>
                <th className="px-2 py-1.5 text-left font-medium">From</th>
                <th className="px-2 py-1.5 text-left font-medium">Relationship</th>
                <th className="px-2 py-1.5 text-left font-medium">Subject</th>
                <th className="px-2 py-1.5 text-left font-medium">Action</th>
                <th className="px-2 py-1.5 text-center font-medium">Account</th>
                <th className="px-2 py-1.5 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.actions.map((action) => {
                const actionInfo = getActionInfo(action.actionTaken)
                const emailColor = getEmailColor(action.emailAccount)

                return (
                  <tr key={action.id} className="hover:bg-muted/50 border-b last:border-0">
                    <td className="text-muted-foreground px-2 py-1.5 whitespace-nowrap">
                      {formatDistanceToNow(new Date(action.updatedAt), { addSuffix: true })}
                    </td>
                    <td
                      className="max-w-[200px] truncate px-2 py-1.5"
                      title={action.senderEmail || 'Unknown'}
                    >
                      {action.senderName || action.senderEmail || '(Unknown)'}
                    </td>
                    <td className="px-2 py-1.5">
                      {action.senderEmail ? (
                        <RelationshipSelector
                          emailAddress={action.senderEmail}
                          currentRelationship={action.relationship}
                        />
                      ) : (
                        <Badge
                          className={`${RelationshipType.COLORS.unknown} px-1.5 py-0 text-xs text-white`}
                        >
                          {RelationshipType.LABELS.unknown}
                        </Badge>
                      )}
                    </td>
                    <td className="max-w-xs truncate px-2 py-1.5" title={action.subject}>
                      {action.subject}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge className={`${actionInfo.color} px-1.5 py-0 text-xs text-white`}>
                        {actionInfo.label}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex justify-center">
                        <div
                          className={`h-3 w-3 rounded-full ${emailColor}`}
                          title={action.emailAccount}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/inbox?emailAccountId=${action.emailAccountId}&messageId=${encodeURIComponent(action.messageId)}`}
                        className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data.total > 20 && (
          <div className="text-muted-foreground mt-4 text-center text-xs">
            Showing 20 of {data.total} total actions
          </div>
        )}
        </CardContent>
      </Card>
    </div>
  )
}
