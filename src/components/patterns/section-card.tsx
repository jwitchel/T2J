import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface SectionCardProps {
  title: string
  description?: string
  children: React.ReactNode
  /** Icon displayed before the title */
  icon?: React.ReactNode
  /** Action buttons/controls displayed on the right side of the header */
  headerAction?: React.ReactNode
  footer?: React.ReactNode
  /** Custom className for the Card container */
  className?: string
  /** Custom className for the CardHeader */
  headerClassName?: string
  /** Custom className for the CardContent */
  contentClassName?: string
  /** Size variant for compact displays */
  size?: 'default' | 'compact'
}

export function SectionCard({
  title,
  description,
  children,
  icon,
  headerAction,
  footer,
  className,
  headerClassName,
  contentClassName,
  size = 'default',
}: SectionCardProps) {
  const isCompact = size === 'compact'

  return (
    <Card className={className}>
      <CardHeader className={cn(isCompact && 'pb-3', headerClassName)}>
        <div className={cn('flex items-center justify-between', (icon || headerAction) && 'gap-3')}>
          <div className={cn('flex items-center', icon && 'gap-3')}>
            {icon}
            <div>
              <CardTitle className={cn(isCompact && 'text-base')}>{title}</CardTitle>
              {description && (
                <CardDescription className={cn(isCompact && 'text-xs')}>
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  )
}
