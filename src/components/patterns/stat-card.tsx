import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StatCardProps {
  title: string
  value: string | number
  /** Optional icon to display next to title */
  icon?: React.ReactNode
  /** Optional description or subtitle */
  description?: string
  /** Show loading state */
  loading?: boolean
  /** Custom className for the Card container */
  className?: string
}

export function StatCard({
  title,
  value,
  icon,
  description,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('gap-3 py-4', className)}>
      <CardHeader className="pb-0">
        <CardTitle className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold">{value}</p>
            {description && <p className="text-muted-foreground text-xs">{description}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
