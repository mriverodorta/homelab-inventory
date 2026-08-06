import { createContext, useContext, type ReactNode } from 'react'
import type { AgentHardwareSuggestion } from '@/types/agent'
import type { InventoryFormValues } from './model'
import type { InventoryFieldChangeMode } from './type-fields'

type AgentFieldSuggestionContextValue = {
  suggestions: Map<string, AgentHardwareSuggestion>
  apply: (fieldName: string, suggestion: AgentHardwareSuggestion) => void
}

const AgentFieldSuggestionContext = createContext<AgentFieldSuggestionContextValue | null>(null)

function formFieldName(fieldPath: string): string | null {
  if (['name', 'manufacturer', 'model'].includes(fieldPath)) return fieldPath
  if (fieldPath === 'specs.speed') return 'speedMt'
  if (fieldPath === 'specs.capacityBytes') return 'capacity'
  if (fieldPath === 'specs.wattageWatts') return 'ratedWatts'
  return null
}

function capacityPatch(value: unknown): Partial<InventoryFormValues> | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const tebibyte = 1024 ** 4
  const gibibyte = 1024 ** 3
  if (value >= tebibyte) {
    return { capacity: String(Number((value / tebibyte).toFixed(2))), storageUnit: 'TB' }
  }
  return { capacity: String(Number((value / gibibyte).toFixed(2))), storageUnit: 'GB' }
}

function suggestionPatch(
  fieldName: string,
  suggestion: AgentHardwareSuggestion,
): Partial<InventoryFormValues> | null {
  if (suggestion.fieldPath === 'specs.capacityBytes') return capacityPatch(suggestion.detectedValue)
  if (fieldName === 'speedMt' || fieldName === 'ratedWatts') {
    return { [fieldName]: String(suggestion.detectedValue) }
  }
  if (['name', 'manufacturer', 'model'].includes(fieldName)) {
    return { [fieldName]: String(suggestion.detectedValue) }
  }
  return null
}

export function AgentFieldSuggestionProvider({
  suggestions,
  onChange,
  children,
}: {
  suggestions: AgentHardwareSuggestion[]
  onChange: (patch: Partial<InventoryFormValues>, mode: InventoryFieldChangeMode) => void
  children: ReactNode
}) {
  const byField = new Map<string, AgentHardwareSuggestion>()
  for (const suggestion of suggestions) {
    const fieldName = formFieldName(suggestion.fieldPath)
    if (fieldName && !byField.has(fieldName)) byField.set(fieldName, suggestion)
  }

  return (
    <AgentFieldSuggestionContext.Provider value={{
      suggestions: byField,
      apply: (fieldName, suggestion) => {
        const patch = suggestionPatch(fieldName, suggestion)
        if (patch) onChange(patch, 'immediate')
      },
    }}>
      {children}
    </AgentFieldSuggestionContext.Provider>
  )
}

export function useAgentFieldSuggestion(fieldName: string) {
  const context = useContext(AgentFieldSuggestionContext)
  const suggestion = context?.suggestions.get(fieldName) ?? null
  return {
    suggestion,
    apply: suggestion ? () => context?.apply(fieldName, suggestion) : null,
  }
}
