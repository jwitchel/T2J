'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/lib/auth-context'
import { RegexTesterModal } from '@/components/regex-tester-modal'

interface TypedNamePreferences {
  removalRegex: string
  appendString: string
}

export function TypedNameSettings() {
  const { user } = useAuth()
  const { success, error } = useToast()
  const [preferences, setPreferences] = useState<TypedNamePreferences>({
    removalRegex: '',
    appendString: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [regexModalOpen, setRegexModalOpen] = useState(false)

  useEffect(() => {
    fetchPreferences()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPreferences = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/settings/typed-name`, {
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 404) {
          // No preferences set yet, that's ok
          return
        }
        throw new Error('Failed to fetch preferences')
      }

      const data = await response.json()
      setPreferences({
        removalRegex: data.preferences?.removalRegex || '',
        appendString: data.preferences?.appendString || '',
      })
    } catch (err) {
      console.error('Error fetching preferences:', err)
      error('Failed to load typed name preferences')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      // Validate regex if provided
      if (preferences.removalRegex) {
        try {
          new RegExp(preferences.removalRegex)
        } catch {
          error('Invalid regular expression')
          return
        }
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/settings/typed-name`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferences }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      success('Typed name preferences saved')
    } catch (err) {
      console.error('Error saving preferences:', err)
      error('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const handleSetPattern = (pattern: string) => {
    setPreferences({ ...preferences, removalRegex: pattern })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="removal-regex">Name Removal Pattern (Regex)</Label>
        <div className="flex gap-2">
          <Input
            id="removal-regex"
            placeholder="e.g., ^[-\\s]*(?:John|J)\\s*$"
            value={preferences.removalRegex}
            onChange={(e) => setPreferences({ ...preferences, removalRegex: e.target.value })}
            className="font-mono text-sm"
          />
          <Button variant="outline" onClick={() => setRegexModalOpen(true)}>
            Test
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Regular expression to match and remove your typed name from emails during training.
          Searches from bottom to top and removes only the first match found. Leave empty to disable
          removal.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="append-string">Name to Append</Label>
        <Input
          id="append-string"
          placeholder="e.g., -John"
          value={preferences.appendString}
          onChange={(e) => setPreferences({ ...preferences, appendString: e.target.value })}
        />
        <p className="text-muted-foreground text-xs">
          Text to append at the end of generated email responses. Leave empty to not append any
          name.
        </p>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save Typed Name Settings
      </Button>

      <RegexTesterModal
        open={regexModalOpen}
        onOpenChange={setRegexModalOpen}
        onAddPattern={handleSetPattern}
        title="Test Name Removal Pattern"
        description="Test your regex pattern against sample text. The pattern will be set as your Name Removal Pattern."
        initialPattern={preferences.removalRegex}
        userName={user?.name || 'John'}
      />
    </div>
  )
}
