'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { SignUpForm } from '@/components/auth/sign-up-form'
import { PublicNavbar } from '@/components/public-navbar'
import { Footer } from '@/components/footer'

export default function SignUpPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard')
    }
  }, [user, loading, router])

  // Show nothing during loading or when about to redirect
  if (loading || user) {
    return null
  }

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
