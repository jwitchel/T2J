'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronDown,
  Mail,
  Database,
  Sparkles,
  Settings,
  LogOut,
  User,
  Briefcase,
  Brain,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import { apiGet } from '@/lib/api'
import { BrandLogo } from '@/components/brand-logo'
import { ThemeToggle } from '@/components/theme-toggle'

export function Navbar() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const [displayName, setDisplayName] = useState<string>('')
  const [isLocalhost, setIsLocalhost] = useState(false)

  useEffect(() => {
    setIsLocalhost(window.location.hostname === 'localhost')
  }, [])

  useEffect(() => {
    const loadUserPreferences = async () => {
      if (!user?.id) return

      try {
        const data = await apiGet<{ preferences: { name?: string } }>('/api/settings/profile')
        if (data.preferences?.name) {
          setDisplayName(data.preferences.name)
        } else if (user.name) {
          setDisplayName(user.name)
        } else {
          setDisplayName(user.email)
        }
      } catch {
        // Fallback to email if preferences can't be loaded
        setDisplayName(user.email)
      }
    }

    loadUserPreferences()
  }, [user])

  if (!user) return null

  const isActive = (path: string) => pathname === path

  const navItems: {
    href: string
    label: string
    icon: React.ComponentType<{ className?: string }>
  }[] = []

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <>
      {isLocalhost && <div className="bg-red-500" style={{ height: '3px' }} />}
      <nav className="border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-12">
              <BrandLogo href="/dashboard" size="md" />

              <div className="ml-4 hidden items-center space-x-1 md:flex">
                {navItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive(item.href)
                          ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700/50 dark:hover:text-zinc-100'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    <span className="hidden sm:inline-block">{displayName || user.email}</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link href="/tone" className="flex cursor-pointer items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Tone Analysis
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/settings" className="flex cursor-pointer items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/settings/email-accounts"
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      Email Accounts
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/settings/llm-providers"
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <Brain className="h-4 w-4" />
                      LLM Providers
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Development Tools</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/jobs" className="flex cursor-pointer items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      Jobs
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/db-browser" className="flex cursor-pointer items-center gap-2">
                      <Database className="h-4 w-4" />
                      Database Browser
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="flex cursor-pointer items-center gap-2 text-red-600 dark:text-red-400"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        <div className="md:hidden">
          <div className="space-y-1 px-2 pt-2 pb-3">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-base font-medium transition-colors',
                    isActive(item.href)
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700/50 dark:hover:text-zinc-100'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>
    </>
  )
}
