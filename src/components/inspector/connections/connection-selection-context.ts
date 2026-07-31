import { createContext } from 'react'

export type InspectorConnectionSelection = {
  onSelectConnection: (connectionId: string | number) => void
}

export const InspectorConnectionSelectionContext = createContext<InspectorConnectionSelection | null>(null)
