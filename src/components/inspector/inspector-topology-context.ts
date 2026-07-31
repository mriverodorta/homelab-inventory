import { createContext } from 'react'
import type { TopologyQueryData } from '@/hooks/use-topology-query'

export type InspectorTopologyState = {
  data: TopologyQueryData | null
  compatibleEndpointKeys: ReadonlySet<string> | null
  statusMessage: string | null
  statusIsError: boolean
}

export const InspectorTopologyContext = createContext<InspectorTopologyState>({
  data: null,
  compatibleEndpointKeys: null,
  statusMessage: null,
  statusIsError: false,
})
