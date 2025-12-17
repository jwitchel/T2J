import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  helperText?: string
  /** Error message - takes precedence over helperText */
  error?: string
  /** Custom className for the container */
  className?: string
}

export function FormField({
  label,
  helperText,
  error,
  className,
  id,
  ...inputProps
}: FormFieldProps) {
  const fieldId = id || label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Input id={fieldId} {...inputProps} />
      {(error || helperText) && (
        <p className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error || helperText}
        </p>
      )}
    </div>
  )
}
