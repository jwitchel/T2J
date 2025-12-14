import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />

      <main className="container mx-auto px-4 sm:px-6 py-12 sm:py-16 flex-1">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-bold mb-6 sm:mb-8">Legal</h1>

          <section className="mb-8 sm:mb-12">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Terms of Service</h2>
            <div className="prose dark:prose-invert max-w-none text-muted-foreground space-y-4">
              <p>
                By using Time to Just, you agree to these terms. Please read them carefully.
              </p>
              <h3 className="text-lg font-medium text-foreground">1. Service Description</h3>
              <p>
                Time to Just provides AI-powered email assistance, including draft generation,
                email organization, and spam detection. The service requires access to your
                email account to function.
              </p>
              <h3 className="text-lg font-medium text-foreground">2. User Responsibilities</h3>
              <p>
                You are responsible for maintaining the security of your account credentials
                and for all activities that occur under your account. You agree to use the
                service only for lawful purposes.
              </p>
              <h3 className="text-lg font-medium text-foreground">3. Service Availability</h3>
              <p>
                We strive to maintain high availability but do not guarantee uninterrupted
                service. We may modify or discontinue features with reasonable notice.
              </p>
              <h3 className="text-lg font-medium text-foreground">4. Limitation of Liability</h3>
              <p>
                Time to Just is provided &quot;as is&quot; without warranties. We are not liable for
                any indirect, incidental, or consequential damages arising from your use
                of the service.
              </p>
            </div>
          </section>

          <section className="mb-8 sm:mb-12">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Privacy Policy</h2>
            <div className="prose dark:prose-invert max-w-none text-muted-foreground space-y-4">
              <h3 className="text-lg font-medium text-foreground">Data We Collect</h3>
              <p>
                We collect email content and metadata necessary to provide our services,
                including sender/recipient information, subject lines, and message bodies.
                We also collect account information you provide during registration.
              </p>
              <h3 className="text-lg font-medium text-foreground">How We Use Your Data</h3>
              <p>
                Your email data is used exclusively to:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Analyze your writing style to generate personalized drafts</li>
                <li>Categorize and organize incoming emails</li>
                <li>Detect spam and unwanted messages</li>
                <li>Improve our AI models (using anonymized, aggregated data only)</li>
              </ul>
              <h3 className="text-lg font-medium text-foreground">Data Security</h3>
              <p>
                We implement industry-standard security measures including encryption
                at rest and in transit, secure OAuth authentication, and regular
                security audits. We never store your email password when using OAuth.
              </p>
              <h3 className="text-lg font-medium text-foreground">Data Sharing</h3>
              <p>
                We do not sell your personal data. We may share data with service
                providers who assist in operating our service, subject to strict
                confidentiality agreements.
              </p>
              <h3 className="text-lg font-medium text-foreground">Your Rights</h3>
              <p>
                You may request access to, correction of, or deletion of your personal
                data at any time by contacting us. Upon account deletion, we will
                remove your data within 30 days.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Cookie Policy</h2>
            <div className="prose dark:prose-invert max-w-none text-muted-foreground space-y-4">
              <p>
                We use essential cookies to maintain your session and remember your
                preferences. We do not use tracking cookies or third-party advertising
                cookies.
              </p>
            </div>
          </section>

          <div className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t text-sm text-muted-foreground">
            Last updated: December 2024
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
