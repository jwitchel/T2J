import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, MessageSquare, Clock } from 'lucide-react'

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />

      <main className="container mx-auto px-4 py-16 flex-1">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">Contact Us</h1>
          <p className="text-xl text-muted-foreground text-center mb-12">
            We&apos;d love to hear from you
          </p>

          <div className="grid md:grid-cols-2 gap-6 mb-12">
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
                  className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
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
                  We typically respond within 24-48 hours during business days.
                  For urgent issues, please include &quot;URGENT&quot; in your subject line.
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
                Have ideas to improve Time to Just? We value your feedback and
                suggestions. Let us know what features you&apos;d like to see or how
                we can make your experience better.
              </CardDescription>
              <a
                href="mailto:feedback@timetojust.com"
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
              >
                feedback@timetojust.com
              </a>
            </CardContent>
          </Card>

          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Before You Reach Out</h2>
            <p className="text-muted-foreground">
              Check our{' '}
              <a href="/faq" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                FAQ page
              </a>
              {' '}for answers to common questions.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
