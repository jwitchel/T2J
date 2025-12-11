import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, Brain, Shield, Zap } from 'lucide-react'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />

      <main className="container mx-auto px-4 py-16 flex-1">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">About Time to Just</h1>
          <p className="text-xl text-muted-foreground text-center mb-12">
            Reclaim your time with AI-powered email assistance
          </p>

          <div className="prose dark:prose-invert max-w-none mb-12">
            <p className="text-lg">
              Time to Just is an AI email assistant that learns your unique writing style and helps you
              respond to emails faster. We believe your time is valuable and should be spent on what
              matters most to you—not drowning in your inbox.
            </p>
            <p className="text-lg">
              Our intelligent system analyzes your past emails to understand how you communicate with
              different people and in different contexts, then generates draft replies that sound
              authentically like you.
            </p>
          </div>

          <h2 className="text-2xl font-semibold mb-6 text-center">Why Choose Time to Just?</h2>

          <div className="grid md:grid-cols-2 gap-6 mb-12">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Brain className="h-8 w-8 text-indigo-500" />
                  <CardTitle>Personalized AI</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Our AI learns your tone, vocabulary, and communication patterns.
                  Every draft sounds like you wrote it because the AI was trained on your style.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Zap className="h-8 w-8 text-amber-500" />
                  <CardTitle>Save Hours Weekly</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Stop spending hours crafting responses. Review and send AI-generated drafts
                  in seconds, freeing up time for what matters.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Mail className="h-8 w-8 text-blue-500" />
                  <CardTitle>Smart Organization</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Automatically categorize emails, detect spam, and prioritize what needs
                  your attention. Focus on emails that matter.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Shield className="h-8 w-8 text-green-500" />
                  <CardTitle>Privacy First</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Your email data stays secure with encrypted storage and OAuth authentication.
                  We never share your data with third parties.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-4">Ready to reclaim your time?</h2>
            <p className="text-muted-foreground mb-6">
              Join thousands of professionals who have simplified their email workflow.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
