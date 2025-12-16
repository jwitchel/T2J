'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface TypedNamePreferences {
  removalRegex: string
  appendString: string
}

export function TypedNameSettings() {
  const { success, error } = useToast()
  const [preferences, setPreferences] = useState<TypedNamePreferences>({
    removalRegex: '',
    appendString: ''
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchPreferences()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPreferences = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}/api/settings/typed-name`, {
        credentials: 'include'
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
        appendString: data.preferences?.appendString || ''
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ preferences })
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

  const handleTestRegex = () => {
    if (!preferences.removalRegex) return

    try {
      const regex = new RegExp(preferences.removalRegex, 'gmi')
      const testText = "Thanks for your help!\n\n-Joe"
      const result = testText.replace(regex, '').trim()
      success(`Test result: "${result}"`)
    } catch {
      error('Invalid regular expression')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="removal-regex">Name Removal Pattern (Regex)</Label>
        <Input
          id="removal-regex"
          placeholder="e.g., ^[-\\s]*(?:Joe|J)\\s*$"
          value={preferences.removalRegex}
          onChange={(e) => setPreferences({ ...preferences, removalRegex: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Regular expression to match and remove your typed name from emails during training. 
          Searches from bottom to top and removes only the first match found.
          Leave empty to disable removal.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestRegex}
          disabled={!preferences.removalRegex}
        >
          Test Regex
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="append-string">Name to Append</Label>
        <Input
          id="append-string"
          placeholder="e.g., -Joe"
          value={preferences.appendString}
          onChange={(e) => setPreferences({ ...preferences, appendString: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Text to append at the end of generated email responses. 
          Leave empty to not append any name.
        </p>
      </div>

      <div className="bg-muted rounded-lg p-4">
        <h4 className="text-sm font-medium mb-2">Example Usage:</h4>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p><strong>Removal Pattern:</strong> <code>^[-\s]*(?:Joe|J)\s*$</code></p>
          <p className="ml-4">Removes &quot;-Joe&quot;, &quot;-J&quot;, &quot;Joe&quot;, &quot; J&quot; etc. from emails</p>
          <p className="ml-4 text-xs">Works bottom-up: only removes the last occurrence (e.g., signature) while preserving names in the email body</p>
          <p><strong>Append String:</strong> <code>-Joe</code></p>
          <p className="ml-4">Adds &quot;-Joe&quot; to the end of generated responses</p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Save Typed Name Settings
      </Button>
    </div>
  )
}