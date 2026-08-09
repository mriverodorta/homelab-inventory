import { createContext, useContext } from 'react'
import type { AgentHardwareSuggestion } from '@/types/agent'

export type AgentFieldSuggestionContextValue = {
  suggestions: Map<string, AgentHardwareSuggestion>
  apply: (fieldName: string, suggestion: AgentHardwareSuggestion) => void
}

export const AgentFieldSuggestionContext = createContext<AgentFieldSuggestionContextValue | null>(null)

export function useAgentFieldSuggestion(fieldName: string) {
  const context = useContext(AgentFieldSuggestionContext)
  const suggestion = context?.suggestions.get(fieldName) ?? null
  return {
    suggestion,
    apply: suggestion ? () => context?.apply(fieldName, suggestion) : null,
  }
}
