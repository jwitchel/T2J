import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  title: string
  description?: string | React.ReactNode
  /** Centered layout for public/marketing pages */
  centered?: boolean
  /** Custom className for the container */
  className?: string
}

export function PageHeader({ title, description, centered = false, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      <h1
        className={cn(
          'font-bold',
          centered ? 'mb-4 text-center text-4xl' : 'text-3xl text-zinc-900 dark:text-zinc-100'
        )}
      >
        {title}
      </h1>
      {description && (
        <p
          className={cn(
            centered ? 'text-muted-foreground text-center text-xl' : 'mt-1 text-zinc-600 dark:text-zinc-400'
          )}
        >
          {description}
        </p>
      )}
    </div>
  )
}
