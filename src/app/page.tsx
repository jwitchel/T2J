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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />

      <main className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 flex-1">
        <div className="max-w-4xl mx-auto text-center mb-12 sm:mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4 sm:mb-6">
            AI-Powered Email Reply Drafts
          </h2>
          <p className="text-lg sm:text-xl text-muted-foreground mb-6 sm:mb-8">
            Generate email responses that match your unique writing tone and style
          </p>
          <Button asChild size="lg">
            <Link href="/signup">Get Started</Link>
          </Button>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 max-w-5xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Tone Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Our AI analyzes your email history to learn your unique writing style,
                ensuring replies sound authentically like you.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Smart Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Generate contextually appropriate email replies in seconds,
                maintaining professionalism while saving time.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email Integration</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Connect your email accounts securely and manage all your
                correspondence from one unified interface.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  )
}