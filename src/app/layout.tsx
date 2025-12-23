import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { AlertProvider } from '@/lib/alert-context'
import { SWRProvider } from '@/components/swr-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { MuiThemeProvider } from '@/components/mui-theme-provider'
import { MuiSnackbarProvider } from '@/components/mui-snackbar-provider'
import { ConfirmProvider } from 'material-ui-confirm'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'AI Email Assistant',
  description: 'AI-powered email reply drafts matching your writing tone',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MuiThemeProvider>
            <MuiSnackbarProvider>
              <ConfirmProvider defaultOptions={{ dialogProps: { disableRestoreFocus: true } }}>
                <AuthProvider>
                  <SWRProvider>
                    <AlertProvider>
                      {children}
                    </AlertProvider>
                  </SWRProvider>
                </AuthProvider>
              </ConfirmProvider>
            </MuiSnackbarProvider>
          </MuiThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
