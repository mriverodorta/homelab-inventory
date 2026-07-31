import type { ComponentType } from 'react'

export type LazyModule<Props> = Promise<{ default: ComponentType<Props> }>

export type LazySurfaceOptions<Props> = {
  displayName: string
  loadingLabel: string
  loadingClassName?: string
  errorTitle?: string
  getClose?: (props: Props) => (() => void) | undefined
  shouldRender?: (props: Props) => boolean
}

export type LazySurfaceComponent<Props> = ComponentType<Props> & {
  prefetch: () => Promise<void>
}
