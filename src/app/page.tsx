'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <PublicNavbar />

      <main className="container mx-auto flex-1 px-4 py-16">
        <div className="mx-auto mb-16 max-w-4xl text-center">
          <h2 className="mb-6 text-5xl font-bold">AI-Powered Email Reply Drafts</h2>
          <p className="text-muted-foreground mb-8 text-xl">
            Generate email responses that match your unique writing tone and style
          </p>
          <Button asChild size="lg">
            <Link href="/signup">Get Started</Link>
          </Button>
        </div>

        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Tone Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Our AI analyzes your email history to learn your unique writing style, ensuring
                replies sound authentically like you.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Smart Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Generate contextually appropriate email replies in seconds, maintaining
                professionalism while saving time.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email Integration</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Connect your email accounts securely and manage all your correspondence from one
                unified interface.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  )
}
