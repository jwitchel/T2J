'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Send } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import { PageHeader, SectionCard } from '@/components/patterns'

export default function LLMDemoPage() {
  const { error: showError } = useToast()
  const [prompt, setPrompt] = useState('')
  const [generatedText, setGeneratedText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showError('Please enter a prompt')
      return
    }

    setIsGenerating(true)
    setError(null)
    setGeneratedText('')

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: prompt.trim(),
          temperature: 0.7,
          max_tokens: 500,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setGeneratedText(data.reply)
      } else {
        setError(data.message || 'Failed to generate text')
        if (response.status === 404) {
          setError('No LLM provider configured. Please add one in settings.')
        }
      }
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <PageHeader title="LLM Demo" description="Test your configured LLM providers" />

      <SectionCard
        title="Generate Text"
        description="Enter a prompt and generate text using your default LLM provider"
        contentClassName="space-y-4"
        className="mb-6"
      >
        <div className="space-y-2">
          <Label htmlFor="prompt">Prompt</Label>
          <Textarea
            id="prompt"
            placeholder="Write a haiku about programming..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="resize-none"
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Generate
            </>
          )}
        </Button>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              {error.includes('No LLM provider') && (
                <Link href="/settings/llm-providers" className="ml-2 underline">
                  Configure Provider
                </Link>
              )}
            </AlertDescription>
          </Alert>
        )}

        {generatedText && (
          <div className="space-y-2">
            <Label>Generated Text:</Label>
            <div className="bg-muted rounded-lg p-4 whitespace-pre-wrap">{generatedText}</div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="LLM Provider Status"
        description="Check which providers are configured"
      >
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            To use this demo, you need to configure at least one LLM provider.
          </p>
          <Link href="/settings/llm-providers">
            <Button variant="outline">Manage LLM Providers</Button>
          </Link>
        </div>
      </SectionCard>
    </div>
  )
}
