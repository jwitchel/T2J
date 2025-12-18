'use client'

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { EmailActionType } from '../../server/src/types/email-action-tracking'
import {
  ActionRuleConditionType,
  USER_ACTION_VALUES,
  UserActionType,
} from '../../server/src/types/action-rules'
import { useToast } from '@/hooks/use-toast'
import { RelationshipType } from '../../server/src/lib/relationships/types'

interface ActionSelectorProps {
  emailAddress: string
  currentAction: string
  relationshipType?: string | null
  onActionRuleCreated?: () => void
}

// Build options from USER_ACTION_VALUES
const ACTION_OPTIONS = USER_ACTION_VALUES.map((value) => ({
  value,
  label: EmailActionType.LABELS[value],
  color: EmailActionType.COLORS[value],
}))

export function ActionSelector({
  emailAddress,
  currentAction,
  relationshipType,
  onActionRuleCreated,
}: ActionSelectorProps) {
  const { success, error } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<UserActionType | null>(null)
  const [ruleType, setRuleType] = useState<ActionRuleConditionType>(
    relationshipType ? ActionRuleConditionType.RELATIONSHIP : ActionRuleConditionType.SENDER
  )

  const handleActionSelect = (newValue: string) => {
    if (newValue === currentAction) return
    setSelectedAction(newValue as UserActionType)
    setRuleType(relationshipType ? ActionRuleConditionType.RELATIONSHIP : ActionRuleConditionType.SENDER)
    setDialogOpen(true)
  }

  const handleCreate = async () => {
    if (!selectedAction) return

    const conditionValue = ruleType === ActionRuleConditionType.SENDER
      ? emailAddress
      : relationshipType

    if (!conditionValue) {
      error('Cannot create relationship rule: no relationship type set')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/action-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          conditionType: ruleType,
          conditionValue,
          targetAction: selectedAction,
        }),
      })

      if (response.status === 409) {
        const data = await response.json()
        error(data.error)
        setDialogOpen(false)
        setSelectedAction(null)
        return
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create action rule')
      }

      const ruleTypeLabel = ruleType === ActionRuleConditionType.SENDER
        ? emailAddress
        : RelationshipType.LABELS[conditionValue]

      success(`Action rule created: ${ruleTypeLabel} → ${EmailActionType.LABELS[selectedAction]}`)
      onActionRuleCreated?.()
      setDialogOpen(false)
      setSelectedAction(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create action rule'
      error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const actionColor = EmailActionType.COLORS[currentAction] || '#71717a'
  const actionLabel = EmailActionType.LABELS[currentAction] || currentAction
  const relationshipColor = relationshipType ? RelationshipType.COLORS[relationshipType] : null
  const relationshipLabel = relationshipType ? RelationshipType.LABELS[relationshipType] : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={isLoading}>
          <Badge
            className="cursor-pointer px-1.5 py-0 text-xs text-white"
            style={{ backgroundColor: actionColor }}
          >
            {isLoading ? '...' : actionLabel}
          </Badge>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={currentAction} onValueChange={handleActionSelect}>
            {ACTION_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                  {option.label}
                </div>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Action Rule</DialogTitle>
            <DialogDescription>
              Choose how to apply the action:{' '}
              {selectedAction && (
                <Badge
                  className="ml-1 px-1.5 py-0 text-xs text-white"
                  style={{ backgroundColor: EmailActionType.COLORS[selectedAction] }}
                >
                  {EmailActionType.LABELS[selectedAction]}
                </Badge>
              )}
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={ruleType}
            onValueChange={(value) => setRuleType(value as ActionRuleConditionType)}
            className="gap-4 py-4"
          >
            {relationshipLabel && (
              <div className="flex items-center space-x-3">
                <RadioGroupItem value={ActionRuleConditionType.RELATIONSHIP} id="relationship" />
                <Label htmlFor="relationship" className="flex items-center gap-2 font-normal cursor-pointer">
                  Apply to all{' '}
                  <Badge
                    className={`${relationshipColor} px-1.5 py-0 text-xs text-white`}
                  >
                    {relationshipLabel}
                  </Badge>
                  {' '}contacts
                </Label>
              </div>
            )}

            <div className="flex items-center space-x-3">
              <RadioGroupItem value={ActionRuleConditionType.SENDER} id="sender" />
              <Label htmlFor="sender" className="font-normal cursor-pointer">
                Apply only to <span className="font-medium">{emailAddress}</span>
              </Label>
            </div>
          </RadioGroup>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
