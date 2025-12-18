'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
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
import { useAuth } from '@/lib/auth-context'
import { Loader2, AlertCircle } from 'lucide-react'
import { RegexTesterModal } from '@/components/regex-tester-modal'

export function SignaturePatterns() {
  const { user } = useAuth()
  const [patterns, setPatterns] = useState<string[]>([])
  const [regexModalOpen, setRegexModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const { success, error } = useToast()

  // Load patterns on mount
  useEffect(() => {
    loadPatterns()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPatterns = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/signature-patterns`, {
        credentials: 'include',
      })

      if (!response.ok) throw new Error('Failed to load patterns')

      const data = await response.json()
      setPatterns(data.patterns || [])
    } catch (err) {
      error('Failed to load signature patterns')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const savePatterns = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/signature-patterns`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patterns }),
      })

      if (!response.ok) {
        const data = await response.json()
        if (data.details) {
          error(
            `Invalid patterns: ${data.details.map((d: { pattern: string }) => d.pattern).join(', ')}`
          )
        } else {
          throw new Error(data.error || 'Failed to save patterns')
        }
        return
      }

      success('Signature patterns saved successfully')
    } catch (err) {
      error('Failed to save patterns')
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddPattern = (pattern: string) => {
    setPatterns([...patterns, pattern])
  }

  const removePattern = (index: number) => {
    setPatterns(patterns.filter((_, i) => i !== index))
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Patterns */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Signature Detection Patterns</Label>
        </div>
        <p className="text-muted-foreground text-sm">
          Regular expressions to match and remove email signatures. Patterns are tested from the
          bottom of emails upward.
        </p>

        {patterns.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <div className="ml-2">
              <p className="text-sm">No patterns configured.</p>
            </div>
          </Alert>
        ) : (
          <div className="space-y-2">
            {patterns.map((pattern, index) => (
              <div key={index} className="flex items-center gap-2">
                <code className="bg-muted flex-1 rounded p-2 font-mono text-sm">{pattern}</code>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="h-7 px-2 text-xs">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Signature Pattern</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this pattern? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => removePattern(index)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add New Pattern */}
      <Button variant="outline" onClick={() => setRegexModalOpen(true)}>
        Add Pattern
      </Button>

      <RegexTesterModal
        open={regexModalOpen}
        onOpenChange={setRegexModalOpen}
        onAddPattern={handleAddPattern}
        title="Add Signature Pattern"
        description="Test your regex pattern against sample text before adding it to your signature detection patterns."
        userName={user?.name || 'John'}
      />

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={savePatterns} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Patterns
        </Button>
      </div>
    </div>
  )
}
