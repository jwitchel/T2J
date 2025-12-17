import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'
import { Mail, MessageSquare, Clock } from 'lucide-react'
import { PageHeader, SectionCard } from '@/components/patterns'

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
            <SectionCard title="Email Support" icon={<Mail className="h-6 w-6 text-indigo-500" />}>
              <p className="text-muted-foreground mb-4">
                For general inquiries, technical support, or account issues.
              </p>
              <a
                href="mailto:support@timetojust.com"
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                support@timetojust.com
              </a>
            </SectionCard>

            <SectionCard
              title="Response Time"
              icon={<Clock className="h-6 w-6 text-amber-500" />}
            >
              <p className="text-muted-foreground">
                We typically respond within 24-48 hours during business days. For urgent issues,
                please include &quot;URGENT&quot; in your subject line.
              </p>
            </SectionCard>
          </div>

          <SectionCard
            title="Feedback"
            icon={<MessageSquare className="h-6 w-6 text-green-500" />}
            className="mb-12"
          >
            <p className="text-muted-foreground mb-4">
              Have ideas to improve Time to Just? We value your feedback and suggestions. Let us
              know what features you&apos;d like to see or how we can make your experience better.
            </p>
            <a
              href="mailto:feedback@timetojust.com"
              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              feedback@timetojust.com
            </a>
          </SectionCard>

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
