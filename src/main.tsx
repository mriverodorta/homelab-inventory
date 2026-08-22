import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ApplicationRoot } from './components/application-root.tsx'
import { queryClient } from './lib/query-client.ts'
import { AuthGate } from './components/auth/auth-gate.tsx'
import { AuthProvider } from './components/auth/auth-provider.tsx'
import { ApplicationLiveEventsProvider } from './live-events/application-live-events-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <ApplicationLiveEventsProvider>
            <ApplicationRoot />
          </ApplicationLiveEventsProvider>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
