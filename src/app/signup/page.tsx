import { SignUpForm } from '@/components/auth/sign-up-form'
import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicNavbar />
      <div className="flex items-center justify-center py-16 flex-1">
        <SignUpForm />
      </div>
      <Footer />
    </div>
  )
}