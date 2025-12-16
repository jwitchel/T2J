import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />

      <main className="container mx-auto px-4 py-16 flex-1">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">How It Works</h1>
          <p className="text-xl text-muted-foreground text-center mb-12">
            See Time to Just in action
          </p>

          {/* Step 1 */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              <Badge variant="outline" className="text-lg px-4 py-1">Step 1</Badge>
              <h2 className="text-2xl font-semibold">Connect Your Email</h2>
            </div>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">
                  Securely connect your Gmail account with OAuth (no password stored) or use
                  IMAP credentials for other providers. Your connection is encrypted and secure.
                </p>
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 font-mono text-sm">
                  <div className="text-green-600 dark:text-green-400">Connected: joe@gmail.com</div>
                  <div className="text-muted-foreground">Last sync: 2 minutes ago</div>
                  <div className="text-muted-foreground">Monitoring: Active</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Step 2 */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              <Badge variant="outline" className="text-lg px-4 py-1">Step 2</Badge>
              <h2 className="text-2xl font-semibold">AI Learns Your Style</h2>
            </div>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">
                  Time to Just analyzes your sent emails to learn how you communicate.
                  It identifies your tone, common phrases, greeting styles, and signature patterns.
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4">
                    <div className="text-sm font-medium mb-2">Tone Analysis</div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div>Professional: 85%</div>
                      <div>Friendly: 72%</div>
                      <div>Concise: 90%</div>
                    </div>
                  </div>
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4">
                    <div className="text-sm font-medium mb-2">Writing Patterns</div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div>Avg. length: 3-4 sentences</div>
                      <div>Common greeting: &quot;Hi&quot;</div>
                      <div>Sign-off: &quot;Best,&quot;</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Step 3 */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              <Badge variant="outline" className="text-lg px-4 py-1">Step 3</Badge>
              <h2 className="text-2xl font-semibold">Automatic Draft Generation</h2>
            </div>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">
                  When new emails arrive, Time to Just automatically generates personalized reply drafts.
                  Each draft matches your communication style for that relationship.
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-zinc-100 dark:bg-zinc-800 p-3 border-b">
                    <div className="font-medium">Incoming Email</div>
                    <div className="text-sm text-muted-foreground">From: sarah@company.com</div>
                  </div>
                  <div className="p-4 bg-white dark:bg-zinc-900">
                    <p className="text-sm mb-2">&quot;Hi, can we reschedule our meeting to Thursday at 2pm?&quot;</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950 p-3 border-t">
                    <div className="font-medium text-blue-700 dark:text-blue-300">AI-Generated Draft</div>
                  </div>
                  <div className="p-4 bg-blue-50/50 dark:bg-blue-950/50">
                    <p className="text-sm">&quot;Hi Sarah,</p>
                    <p className="text-sm mt-2">Thursday at 2pm works great for me. I&apos;ll update the calendar invite.</p>
                    <p className="text-sm mt-2">Best,<br/>John&quot;</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Step 4 */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              <Badge variant="outline" className="text-lg px-4 py-1">Step 4</Badge>
              <h2 className="text-2xl font-semibold">Review and Send</h2>
            </div>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground mb-4">
                  Review AI-generated drafts in your email client&apos;s drafts folder.
                  Edit if needed, then send. Time to Just learns from your edits to improve future drafts.
                </p>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span>Draft ready in drafts folder</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span>Edit as needed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                    <span>Send when ready</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-4">Ready to try it yourself?</h2>
            <p className="text-muted-foreground">
              Sign up for free and experience the future of email management.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
