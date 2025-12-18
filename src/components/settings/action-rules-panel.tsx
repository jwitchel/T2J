'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { Loader2, AlertCircle } from 'lucide-react'
import { EmailActionType } from '../../../server/src/types/email-action-tracking'
import { ActionRuleConditionType } from '../../../server/src/types/action-rules'
import { RelationshipType } from '../../../server/src/lib/relationships/types'

interface ActionRule {
  id: string
  userId: string
  conditionType: ActionRuleConditionType
  conditionValue: string
  targetAction: string
  priority: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function ActionRulesPanel() {
  const [rules, setRules] = useState<ActionRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { success, error } = useToast()

  useEffect(() => {
    loadRules()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadRules = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/action-rules`, {
        credentials: 'include',
      })

      if (!response.ok) throw new Error('Failed to load action rules')

      const data = await response.json()
      setRules(data.rules)
    } catch (err) {
      error('Failed to load action rules')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const deleteRule = async (ruleId: string) => {
    setDeletingId(ruleId)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/action-rules/${ruleId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete rule')
      }

      setRules(rules.filter((r) => r.id !== ruleId))
      success('Action rule deleted')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete rule'
      error(message)
    } finally {
      setDeletingId(null)
    }
  }

  // Group rules by condition type
  const senderRules = rules.filter((r) => r.conditionType === ActionRuleConditionType.SENDER)
  const relationshipRules = rules.filter((r) => r.conditionType === ActionRuleConditionType.RELATIONSHIP)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }

  if (rules.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <p>No action rules configured.</p>
          <p className="text-muted-foreground">
            Create rules by clicking on an action in the Dashboard&apos;s recent actions table.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  const RuleRow = ({ rule }: { rule: ActionRule }) => {
    const actionColor = EmailActionType.COLORS[rule.targetAction] || '#71717a'
    const actionLabel = EmailActionType.LABELS[rule.targetAction] || rule.targetAction

    const isRelationship = rule.conditionType === ActionRuleConditionType.RELATIONSHIP
    const relationshipColor = isRelationship ? RelationshipType.COLORS[rule.conditionValue] : null
    const conditionLabel = isRelationship
      ? RelationshipType.LABELS[rule.conditionValue]
      : rule.conditionValue

    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
        <div className="flex items-center gap-2">
          {isRelationship ? (
            <Badge className={`${relationshipColor} px-1.5 py-0 text-xs text-white`}>
              {conditionLabel}
            </Badge>
          ) : (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
              {conditionLabel}
            </Badge>
          )}
          <span className="text-muted-foreground">→</span>
          <Badge
            className="px-1.5 py-0 text-xs text-white"
            style={{ backgroundColor: actionColor }}
          >
            {actionLabel}
          </Badge>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={deletingId === rule.id}
            >
              {deletingId === rule.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Delete'
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Action Rule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this rule? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteRule(rule.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {senderRules.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Sender rules (applied to specific email addresses, processed first):
          </p>
          <div className="space-y-2">
            {senderRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </div>
        </div>
      )}

      {relationshipRules.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Relationship rules (applied to all contacts of a type, processed after sender rules):
          </p>
          <div className="space-y-2">
            {relationshipRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
