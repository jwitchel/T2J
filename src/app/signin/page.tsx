import { SignInForm } from '@/components/auth/sign-in-form'
import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function SignInPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <PublicNavbar />
      <div className="flex flex-1 items-center justify-center py-16">
        <SignInForm />
      </div>
      <Footer />
    </div>
  )
}
