import Link from 'next/link'

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t bg-zinc-50 dark:bg-zinc-900">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="text-muted-foreground text-sm">
            &copy; {currentYear} Time to Just. All rights reserved.
          </div>

          <nav className="flex flex-wrap justify-center items-center gap-4 sm:gap-6 text-sm">
            <Link
              href="/about"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              About
            </Link>
            <Link
              href="/contact"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Contact Us
            </Link>
            <Link
              href="/legal"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Legal
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
