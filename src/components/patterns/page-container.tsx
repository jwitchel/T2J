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
      className={cn('container mx-auto flex flex-col px-4 py-6 md:px-6', className)}
      style={fullHeight ? { height: 'calc(100vh - 64px)' } : undefined}
    >
      {children}
    </div>
  )
}
