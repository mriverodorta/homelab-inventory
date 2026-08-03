import { createContext } from 'react'

export type AuditIgnoreHandler = (warningId: string, ignored: boolean) => void

export const AuditIgnoreContext = createContext<AuditIgnoreHandler | null>(null)
