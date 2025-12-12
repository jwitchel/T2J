import { SignUpForm } from '@/components/auth/sign-up-form'
import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function SignUpPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <PublicNavbar />
      <div className="flex flex-1 items-center justify-center py-16">
        <SignUpForm />
      </div>
      <Footer />
    </div>
  )
}
