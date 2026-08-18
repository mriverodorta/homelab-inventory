import { createContext } from 'react'
import type { ApplicationLiveEvent, ApplicationLiveTopic } from './model'

export type ApplicationLiveSubscription = Readonly<{
  topic: ApplicationLiveTopic
  onEvent(event: ApplicationLiveEvent): void
  onResync(): void
}>

export type ApplicationLiveEventsContextValue = Readonly<{
  subscribe(subscription: ApplicationLiveSubscription): () => void
}>

export const ApplicationLiveEventsContext = createContext<ApplicationLiveEventsContextValue | null>(null)

