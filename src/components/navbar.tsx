'use client'

import Link from 'next/link'
import Image from 'next/image'
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
  Code2,
  Home,
  Sparkles,
  Settings,
  LogOut,
  User,
  Briefcase,
  Brain
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import { apiGet } from '@/lib/api'

export function Navbar() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const [displayName, setDisplayName] = useState<string>('')

  // Rotating words and colors for "Time to Just ___"
  const words = ['Think', 'Breathe', 'Work', 'Plan', 'Ride', 'Run', 'Smile', 'Relax', 'Center', 'Spin', 'Walk', 'Sleep', 'Stretch', 'Move', 'Laugh', 'Make', 'Build', 'Design', 'Paint', 'Sketch']
  const colors = ['#93c5fd', '#a5b4fc', '#c4b5fd', '#f9a8d4', '#fdba74', '#fcd34d', '#86efac', '#67e8f9', '#94a3b8']
  const [wordIndex, setWordIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

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

  // Rotate words with fade effect
  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out
      setIsVisible(false)

      // After fade out, change word and fade in
      setTimeout(() => {
        setWordIndex((prev) => (prev + 1) % words.length)
        setIsVisible(true)
      }, 5000) // Match this with CSS transition duration
    }, 15000) // Change word every 15 seconds

    return () => clearInterval(interval)
  }, [words.length])

  if (!user) return null

  const isActive = (path: string) => pathname === path

  const navItems: { href: string; label: string; icon: any }[] = []

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <nav className="bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand and Main Navigation */}
          <div className="flex items-center space-x-12">
            <Link href="/dashboard" className="flex items-center space-x-3">
              <Image
                src="/logo.png"
                alt="Time to Just Logo"
                width={32}
                height={32}
                className="object-contain logo-rotate"
                style={{ width: '32px', height: '32px' }}
              />
              <span className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                Time to Just{' '}
                <span
                  style={{
                    display: 'inline-block',
                    minWidth: '80px',
                    borderBottom: '2px solid #000',
                    paddingBottom: '0',
                    marginBottom: '-2px',
                    verticalAlign: 'baseline',
                  }}
                >
                  <span
                    style={{
                      color: colors[wordIndex % colors.length],
                      opacity: isVisible ? 1 : 0,
                      transition: 'opacity 5s linear',
                    }}
                  >
                    {words[wordIndex]}
                  </span>
                </span>
              </span>
            </Link>

            {/* Main Navigation */}
            <div className="hidden md:flex items-center space-x-1 ml-4">
              {navItems.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      isActive(item.href)
                        ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 hover:text-zinc-900 dark:hover:text-zinc-100"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right side - User menu */}
          <div className="flex items-center space-x-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="flex items-center gap-2"
                >
                  <User className="h-4 w-4" />
                  <span className="hidden sm:inline-block">{displayName || user.email}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href="/tone" className="flex items-center gap-2 cursor-pointer">
                    <Sparkles className="h-4 w-4" />
                    Tone Analysis
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/email-accounts" className="flex items-center gap-2 cursor-pointer">
                    <Mail className="h-4 w-4" />
                    Email Accounts
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/llm-providers" className="flex items-center gap-2 cursor-pointer">
                    <Brain className="h-4 w-4" />
                    LLM Providers
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Development Tools</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/jobs" className="flex items-center gap-2 cursor-pointer">
                    <Briefcase className="h-4 w-4" />
                    Jobs
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/db-browser" className="flex items-center gap-2 cursor-pointer">
                    <Database className="h-4 w-4" />
                    Database Browser
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="flex items-center gap-2 cursor-pointer text-red-600 dark:text-red-400"
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
        <div className="px-2 pt-2 pb-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-base font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 hover:text-zinc-900 dark:hover:text-zinc-100"
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
  )
}