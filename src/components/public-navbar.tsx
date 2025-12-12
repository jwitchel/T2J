'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/brand-logo'
import { cn } from '@/lib/utils'

const navLinks = [
  { href: '/about', label: 'About' },
  { href: '/demo', label: 'Demo' },
  { href: '/faq', label: 'FAQ' },
]

export function PublicNavbar() {
  const pathname = usePathname()

  return (
    <header className="border-b bg-white dark:bg-zinc-800">
      <div className="container mx-auto flex items-center justify-between px-4 py-4">
        <div className="flex items-center space-x-8">
          <BrandLogo href="/" size="md" />

          <nav className="hidden items-center space-x-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700/50 dark:hover:text-zinc-100'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex gap-4">
          <Button asChild variant="ghost">
            <Link href="/signin">Sign In</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Sign Up</Link>
          </Button>
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="flex space-x-2 px-4 pb-3 md:hidden">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              pathname === link.href
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400'
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
