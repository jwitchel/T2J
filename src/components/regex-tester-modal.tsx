'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react'

interface RegexTestResult {
  valid: boolean
  matched: boolean
  matchedText?: string
  error?: string
}

interface RegexTesterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddPattern: (pattern: string) => void
  title?: string
  description?: string
  initialPattern?: string
  userName?: string
}

function generateTestEmail(userName: string): string {
  const nameParts = userName.split(' ')
  const firstName = nameParts[0]!
  return `Hi there,

Thanks for your email. I wanted to follow up on our conversation.

Let me know if you have any questions.

-${firstName}

---
${userName}
Senior Developer
Company Inc.
${firstName.toLowerCase()}@company.com`
}

export function RegexTesterModal({
  open,
  onOpenChange,
  onAddPattern,
  title = 'Test Regex Pattern',
  description = 'Test your regex pattern against sample text before adding it.',
  initialPattern = '',
  userName = 'John',
}: RegexTesterModalProps) {
  const [pattern, setPattern] = useState(initialPattern)
  const [testText, setTestText] = useState('')
  const [testResult, setTestResult] = useState<RegexTestResult | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPattern(initialPattern)
      setTestText(generateTestEmail(userName))
      setTestResult(null)
    }
  }, [open, initialPattern, userName])

  const handleTest = () => {
    if (!pattern.trim()) {
      setTestResult({ valid: false, matched: false, error: 'Please enter a regex pattern' })
      return
    }

    try {
      const regex = new RegExp(pattern, 'm')
      const match = testText.match(regex)

      if (match) {
        setTestResult({
          valid: true,
          matched: true,
          matchedText: match[0],
        })
      } else {
        setTestResult({
          valid: true,
          matched: false,
        })
      }
    } catch (err) {
      setTestResult({
        valid: false,
        matched: false,
        error: err instanceof Error ? err.message : 'Invalid regex pattern',
      })
    }
  }

  const handleAddPattern = () => {
    if (!pattern.trim()) return

    // Validate regex before adding
    try {
      new RegExp(pattern)
      onAddPattern(pattern.trim())
      onOpenChange(false)
    } catch {
      setTestResult({
        valid: false,
        matched: false,
        error: 'Cannot add invalid regex pattern',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[600px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Pattern Input */}
          <div className="space-y-2">
            <Label htmlFor="regex-pattern">Regex Pattern</Label>
            <Input
              id="regex-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g., ^-+\s*$"
              className="font-mono text-sm"
            />
          </div>

          {/* Test Text */}
          <div className="space-y-2">
            <Label htmlFor="test-text">Test Email</Label>
            <Textarea
              id="test-text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
          </div>

          {/* Test Button */}
          <Button onClick={handleTest} variant="outline" className="w-full">
            Test Pattern
          </Button>

          {/* Test Results */}
          {testResult && (
            <Alert>
              {testResult.error ? (
                <AlertCircle className="h-4 w-4 text-red-500" />
              ) : testResult.matched ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-orange-500" />
              )}
              <AlertDescription className="ml-2">
                {testResult.error ? (
                  <span className="text-red-600">{testResult.error}</span>
                ) : testResult.matched ? (
                  <div>
                    <p className="font-medium text-green-600">Pattern matched!</p>
                    <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 text-xs whitespace-pre-wrap">
                      {testResult.matchedText}
                    </pre>
                  </div>
                ) : (
                  <span className="text-orange-600">No match found in test text</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Example Panel */}
          <div className="bg-muted rounded-lg p-4">
            <h4 className="mb-2 text-sm font-medium">Common Patterns:</h4>
            <div className="text-muted-foreground space-y-1 text-xs">
              <p>
                <code className="bg-background rounded px-1">^-+\s*$</code> - Line of dashes
              </p>
              <p>
                <code className="bg-background rounded px-1">^--\s*$</code> - Standard signature
                delimiter
              </p>
              <p>
                <code className="bg-background rounded px-1">^[-\s]*{userName.split(' ')[0]}\s*$</code>{' '}
                - Name with optional dash/spaces
              </p>
              <p>
                <code className="bg-background rounded px-1">---[\s\S]*?@company\.com</code> -
                Multi-line signature block
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAddPattern} disabled={!pattern.trim()}>
            Add Pattern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
