import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import './index.css'
import { DomainEngineGate } from './components/domain-engine-gate.tsx'
import { DomainEngineProvider } from './components/domain-engine-provider.tsx'
import { LazyWorkspaceApp } from './components/lazy-workspace-app.tsx'
import { queryClient } from './lib/query-client.ts'
import { AuthGate } from './components/auth/auth-gate.tsx'
import { AuthProvider } from './components/auth/auth-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <DomainEngineProvider enabled>
            <DomainEngineGate>
              <LazyWorkspaceApp />
            </DomainEngineGate>
          </DomainEngineProvider>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
