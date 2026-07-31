import { createContext } from 'react'

export const AuditIgnoreContext = createContext<(warningId: string, ignored: boolean) => void>(() => undefined)
