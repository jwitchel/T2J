import { Alert, AlertTitle, AlertDescription, type AlertVariant } from '@/components/ui/alert'
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

const iconMap = {
  default: AlertCircle,
  destructive: AlertCircle,
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
}

export interface AlertMessageProps {
  variant?: AlertVariant | 'warning'
  title?: string
  children: React.ReactNode
  /** Custom className for the Alert container */
  className?: string
  /** Hide the default icon */
  hideIcon?: boolean
}

export function AlertMessage({
  variant = 'default',
  title,
  children,
  className,
  hideIcon = false,
}: AlertMessageProps) {
  const Icon = iconMap[variant]
  const alertVariant = variant === 'warning' ? 'default' : variant

  return (
    <Alert variant={alertVariant} className={cn(variant === 'warning' && 'border-yellow-500', className)}>
      {!hideIcon && <Icon className="h-4 w-4" />}
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
