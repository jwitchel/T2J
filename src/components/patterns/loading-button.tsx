import { Button, buttonVariants } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { type VariantProps } from 'class-variance-authority'

export interface LoadingButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  loadingText?: string
  /** Icon to show when not loading */
  icon?: React.ReactNode
}

export function LoadingButton({
  loading = false,
  loadingText,
  icon,
  children,
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingText || children}
        </>
      ) : (
        <>
          {icon && <span className="mr-2">{icon}</span>}
          {children}
        </>
      )}
    </Button>
  )
}
