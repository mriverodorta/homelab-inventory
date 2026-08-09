import { useId, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { AgentFieldSuggestionButton } from './agent-field-suggestion'
import { useAgentFieldSuggestion } from './agent-field-suggestion-state'
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

export function FieldError({ message, id }: { message?: string; id?: string }) {
  return message ? <span id={id} role="alert" className="block text-xs font-semibold text-[#8b3322]">{message}</span> : null
}

export function TextField({
  label,
  ariaLabel,
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
  ariaLabel?: string
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
  const errorId = useId()
  const detected = useAgentFieldSuggestion(name)

  return (
    <FieldLabel className={className}>
      <span>{label}</span>
      <div className="relative">
        <Input
          aria-label={ariaLabel ?? label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          name={name}
          value={value}
          placeholder={placeholder}
          type={type}
          min={min}
          step={step}
          required={required}
          className={`${fieldClassName()} ${detected.suggestion ? 'pr-10' : ''}`}
          onChange={(event) => onChange(event.target.value)}
        />
        {detected.suggestion && detected.apply ? (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">
            <AgentFieldSuggestionButton
              label={label}
              currentValue={value}
              detectedValue={detected.suggestion.detectedValue}
              sourceLocator={detected.suggestion.source.locator}
              onApply={detected.apply}
            />
          </span>
        ) : null}
      </div>
      <FieldError id={errorId} message={error} />
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
  options: readonly (string | { value: string; label: string })[]
  error?: string
  className?: string
  emptyLabel?: string
  onValueChange: (value: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  const errorId = useId()
  const detected = useAgentFieldSuggestion(name ?? '')
  const optionValues = options.map((option) => typeof option === 'string' ? option : option.value)
  const labels = new Map(
    options
      .filter((option): option is { value: string; label: string } => typeof option !== 'string')
      .map((option) => [option.value, option.label]),
  )
  const selectableOptions = withLegacyOption(optionValues, value)
  const selectValue = value || (emptyLabel ? 'none' : '')

  return (
    <FieldLabel className={className}>
      <span>{label}</span>
      <div className="flex min-w-0 items-center gap-1">
        <Select
          name={name}
          value={selectValue}
          onValueChange={(nextValue) => onValueChange(nextValue === 'none' ? '' : nextValue)}
          onOpenChange={onOpenChange}
        >
          <SelectTrigger aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className={`${fieldClassName()} min-w-0 flex-1`}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {emptyLabel ? <SelectItem value="none">{emptyLabel}</SelectItem> : null}
            {selectableOptions.filter(Boolean).map((option) => (
              <SelectItem key={option} value={option}>
                {option === value && !optionValues.includes(option)
                  ? `${option} (Legacy)`
                  : labels.get(option) ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {detected.suggestion && detected.apply ? (
          <AgentFieldSuggestionButton
            label={label}
            currentValue={value}
            detectedValue={detected.suggestion.detectedValue}
            sourceLocator={detected.suggestion.source.locator}
            onApply={detected.apply}
          />
        ) : null}
      </div>
      <FieldError id={errorId} message={error} />
    </FieldLabel>
  )
}
