import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fieldClassName, withLegacyOption } from './options'

export function FieldLabel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <label className={`space-y-1 text-xs font-bold text-[#75695d] ${className}`}>{children}</label>
}

export function FieldError({ message }: { message?: string }) {
  return message ? <span role="alert" className="block text-xs font-semibold text-[#8b3322]">{message}</span> : null
}

export function TextField({
  label,
  name,
  value,
  placeholder,
  type = 'text',
  min,
  step,
  required,
  error,
  className,
  onChange,
}: {
  label: string
  name: string
  value: string
  placeholder?: string
  type?: 'text' | 'number'
  min?: number
  step?: number | string
  required?: boolean
  error?: string
  className?: string
  onChange: (value: string) => void
}) {
  return (
    <FieldLabel className={className}>
      <span>{label}</span>
      <Input
        aria-label={label}
        aria-invalid={Boolean(error)}
        name={name}
        value={value}
        placeholder={placeholder}
        type={type}
        min={min}
        step={step}
        required={required}
        className={fieldClassName()}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError message={error} />
    </FieldLabel>
  )
}

export function SelectField({
  label,
  name,
  value,
  placeholder = 'Select',
  options,
  error,
  className,
  emptyLabel,
  onValueChange,
  onOpenChange,
}: {
  label: string
  name?: string
  value: string
  placeholder?: string
  options: string[]
  error?: string
  className?: string
  emptyLabel?: string
  onValueChange: (value: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  const selectableOptions = withLegacyOption(options, value)
  const selectValue = value || (emptyLabel ? 'none' : '')

  return (
    <FieldLabel className={className}>
      <span>{label}</span>
      <Select
        name={name}
        value={selectValue}
        onValueChange={(nextValue) => onValueChange(nextValue === 'none' ? '' : nextValue)}
        onOpenChange={onOpenChange}
      >
        <SelectTrigger aria-label={label} aria-invalid={Boolean(error)} className={fieldClassName()}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {emptyLabel ? <SelectItem value="none">{emptyLabel}</SelectItem> : null}
          {selectableOptions.filter(Boolean).map((option) => (
            <SelectItem key={option} value={option}>
              {option === value && !options.includes(option) ? `${option} (Legacy)` : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </FieldLabel>
  )
}
