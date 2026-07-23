import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DomainEngineGate } from './components/domain-engine-gate.tsx'
import { DomainEngineProvider } from './components/domain-engine-provider.tsx'
import { queryClient } from './lib/query-client.ts'

const domainEngineRequired = import.meta.env.VITE_DOMAIN_ENGINE === 'required'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DomainEngineProvider enabled={domainEngineRequired}>
        <DomainEngineGate>
          <App />
        </DomainEngineGate>
      </DomainEngineProvider>
    </QueryClientProvider>
  </StrictMode>,
)
