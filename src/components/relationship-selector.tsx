'use client'

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { RelationshipType } from '../../server/src/lib/relationships/types'
import { useToast } from '@/hooks/use-toast'

interface RelationshipSelectorProps {
  emailAddress: string
  currentRelationship: string
  onRelationshipChange?: (newRelationship: string) => void
}

const RELATIONSHIP_OPTIONS = [
  { value: RelationshipType.SPOUSE, label: 'Spouse' },
  { value: RelationshipType.FAMILY, label: 'Family' },
  { value: RelationshipType.COLLEAGUE, label: 'Colleague' },
  { value: RelationshipType.FRIENDS, label: 'Friends' },
  { value: RelationshipType.EXTERNAL, label: 'External' },
  { value: RelationshipType.SPAM, label: 'Spam' },
]

export function RelationshipSelector({
  emailAddress,
  currentRelationship,
  onRelationshipChange,
}: RelationshipSelectorProps) {
  const { success, error } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [relationship, setRelationship] = useState(currentRelationship)

  const handleRelationshipChange = async (newValue: string) => {
    if (newValue === relationship) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/relationships/by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAddress,
          relationshipType: newValue,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update relationship')
      }

      setRelationship(newValue)
      onRelationshipChange?.(newValue)
      success(`Relationship updated to ${RelationshipType.LABELS[newValue]}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update relationship'
      error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const relationshipColor = RelationshipType.COLORS[relationship] || RelationshipType.COLORS.unknown
  const relationshipLabel = RelationshipType.LABELS[relationship] || RelationshipType.LABELS.unknown

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isLoading}>
        <Badge className={`${relationshipColor} cursor-pointer px-1.5 py-0 text-xs text-white`}>
          {isLoading ? '...' : relationshipLabel}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={relationship} onValueChange={handleRelationshipChange}>
          {RELATIONSHIP_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${RelationshipType.COLORS[option.value]}`} />
                {option.label}
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
