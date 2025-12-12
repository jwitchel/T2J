import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, MessageSquare, Clock } from 'lucide-react'
import { PageHeader } from '@/components/patterns'

export default function ContactPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <PublicNavbar />

      <main className="container mx-auto flex-1 px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="Contact Us"
            description="We'd love to hear from you"
            centered
            className="mb-12"
          />

          <div className="mb-12 grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Mail className="h-6 w-6 text-indigo-500" />
                  <CardTitle>Email Support</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-4">
                  For general inquiries, technical support, or account issues.
                </CardDescription>
                <a
                  href="mailto:support@timetojust.com"
                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  support@timetojust.com
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Clock className="h-6 w-6 text-amber-500" />
                  <CardTitle>Response Time</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  We typically respond within 24-48 hours during business days. For urgent issues,
                  please include &quot;URGENT&quot; in your subject line.
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          <Card className="mb-12">
            <CardHeader>
              <div className="flex items-center gap-3">
                <MessageSquare className="h-6 w-6 text-green-500" />
                <CardTitle>Feedback</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="mb-4">
                Have ideas to improve Time to Just? We value your feedback and suggestions. Let us
                know what features you&apos;d like to see or how we can make your experience better.
              </CardDescription>
              <a
                href="mailto:feedback@timetojust.com"
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                feedback@timetojust.com
              </a>
            </CardContent>
          </Card>

          <div className="text-center">
            <h2 className="mb-2 text-xl font-semibold">Before You Reach Out</h2>
            <p className="text-muted-foreground">
              Check our{' '}
              <a href="/faq" className="text-indigo-600 hover:underline dark:text-indigo-400">
                FAQ page
              </a>{' '}
              for answers to common questions.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
