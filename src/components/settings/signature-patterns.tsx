'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Trash2, AlertCircle, CheckCircle } from 'lucide-react'

export function SignaturePatterns() {
  const [patterns, setPatterns] = useState<string[]>([])
  const [newPattern, setNewPattern] = useState('')
  const [testText, setTestText] = useState('')
  const [testResults, setTestResults] = useState<{
    patterns?: Array<{
      pattern: string
      matches?: unknown[]
      wouldRemoveFrom?: number
      error?: string
    }>
    removal?: { cleanedText: string; signature: string; matchedPattern: string }
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
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

  const addPattern = () => {
    if (newPattern.trim()) {
      // Test if it's a valid regex
      try {
        new RegExp(newPattern)
        setPatterns([...patterns, newPattern.trim()])
        setNewPattern('')
      } catch {
        error('Invalid regular expression')
      }
    }
  }

  const removePattern = (index: number) => {
    setPatterns(patterns.filter((_, i) => i !== index))
  }

  const testPatterns = async () => {
    if (!testText.trim()) {
      error('Please enter some text to test')
      return
    }

    setIsTesting(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL!}/api/signature-patterns/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            text: testText,
            patterns: patterns.length > 0 ? patterns : undefined,
          }),
        }
      )

      if (!response.ok) throw new Error('Failed to test patterns')

      const data = await response.json()
      setTestResults(data)
    } catch (err) {
      error('Failed to test patterns')
      console.error(err)
    } finally {
      setIsTesting(false)
    }
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
              <p className="text-sm">No patterns configured. Using default patterns.</p>
            </div>
          </Alert>
        ) : (
          <div className="space-y-2">
            {patterns.map((pattern, index) => (
              <div key={index} className="flex items-center gap-2">
                <code className="bg-muted flex-1 rounded p-2 font-mono text-sm">{pattern}</code>
                <Button variant="ghost" size="sm" onClick={() => removePattern(index)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add New Pattern */}
      <div className="space-y-2">
        <Label htmlFor="new-pattern">Add Pattern</Label>
        <div className="flex gap-2">
          <Input
            id="new-pattern"
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="e.g., ——+[\s\S]*?example\.com\/"
            className="font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPattern()
              }
            }}
          />
          <Button onClick={addPattern} disabled={!newPattern.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Hint: Use multiline patterns like{' '}
          <code className="bg-muted rounded px-1 py-0.5">——+[\s\S]*?example\.com\/</code> to match
          signatures that span multiple lines
        </p>
      </div>

      {/* Test Patterns */}
      <div className="space-y-2">
        <Label htmlFor="test-text">Test Your Patterns</Label>
        <Textarea
          id="test-text"
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="Paste an email here to test signature detection..."
          rows={6}
          className="font-mono text-sm"
        />
        <Button onClick={testPatterns} disabled={!testText.trim() || isTesting} variant="outline">
          {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Test Patterns
        </Button>

        {testResults && (
          <div className="mt-4 space-y-4">
            {testResults.removal?.signature && (
              <Alert>
                <CheckCircle className="h-4 w-4 text-green-500" />
                <div className="ml-2">
                  <p className="text-sm font-medium">Signature detected!</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Matched pattern:{' '}
                    <code className="bg-muted rounded px-1 py-0.5">
                      {testResults.removal?.matchedPattern}
                    </code>
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm">View detected signature</summary>
                    <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 text-xs">
                      {testResults.removal?.signature}
                    </pre>
                  </details>
                </div>
              </Alert>
            )}

            {!testResults.removal?.signature && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <div className="ml-2">
                  <p className="text-sm">No signature detected with current patterns</p>
                </div>
              </Alert>
            )}
          </div>
        )}
      </div>

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

// Import Input component since it's missing
import { Input } from '@/components/ui/input'
