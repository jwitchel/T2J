import { cn } from '@/lib/utils'

export interface PageContainerProps {
  children: React.ReactNode
  /** Use full viewport height minus navbar (for scroll-locked pages) */
  fullHeight?: boolean
  /** Custom className for the container */
  className?: string
}

export function PageContainer({ children, fullHeight = false, className }: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8',
        className
      )}
      style={fullHeight ? { height: 'calc(100vh - 64px)' } : undefined}
    >
      {children}
    </div>
  )
}
