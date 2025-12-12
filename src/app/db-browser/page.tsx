'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Database, Terminal, ExternalLink } from 'lucide-react'

export default function DbBrowserPage() {
  return (
    <div className="min-h-screen bg-zinc-50 py-8 dark:bg-zinc-900">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">Database Browser</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Explore and manage the PostgreSQL database
          </p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>PostgreSQL Connection</CardTitle>
              <CardDescription>Access the database through various tools</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
                <p className="mb-2 text-sm font-medium">Connection Details:</p>
                <div className="space-y-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
                  <p>Host: localhost</p>
                  <p>Port: 5434</p>
                  <p>Database: aiemaildb</p>
                  <p>Username: aiemailuser</p>
                  <p>Password: aiemailpass</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="mb-4">
                  <Button asChild className="w-full" size="lg">
                    <a href="http://localhost:8889" target="_blank" rel="noopener noreferrer">
                      Open pgAdmin
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Using psql CLI:</h3>
                  <div className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-100">
                    docker exec -it test-repo-postgres-1 psql -U aiemailuser -d aiemaildb
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Main Tables:</h3>
                  <ul className="ml-2 list-inside list-disc space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    <li>
                      <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                        user
                      </code>{' '}
                      - User accounts
                    </li>
                    <li>
                      <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                        session
                      </code>{' '}
                      - Auth sessions
                    </li>
                    <li>
                      <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                        email_accounts
                      </code>{' '}
                      - Connected email accounts
                    </li>
                    <li>
                      <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                        llm_providers
                      </code>{' '}
                      - AI provider configurations
                    </li>
                    <li>
                      <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                        tone_preferences
                      </code>{' '}
                      - Writing style profiles
                    </li>
                    <li>
                      <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                        user_relationships
                      </code>{' '}
                      - Contact categories
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>GUI Tools</CardTitle>
              <CardDescription>Recommended database management tools</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-5 w-5 text-zinc-500" />
                  <div>
                    <h3 className="text-sm font-medium">TablePlus</h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Modern database GUI with support for PostgreSQL
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-5 w-5 text-zinc-500" />
                  <div>
                    <h3 className="text-sm font-medium">DBeaver</h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Free, open-source universal database tool
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Terminal className="mt-0.5 h-5 w-5 text-zinc-500" />
                  <div>
                    <h3 className="text-sm font-medium">pgAdmin</h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Official PostgreSQL administration tool
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
