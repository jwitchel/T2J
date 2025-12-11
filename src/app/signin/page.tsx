import { SignInForm } from '@/components/auth/sign-in-form'
import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />
      <div className="flex items-center justify-center py-16 flex-1">
        <SignInForm />
      </div>
      <Footer />
    </div>
  )
}