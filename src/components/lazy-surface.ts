import { createElement, lazy } from 'react'
import type {
  LazyModule,
  LazySurfaceComponent,
  LazySurfaceOptions,
} from '@/components/lazy-surface-contract'
import { LazySurfaceView } from '@/components/lazy-surface-view'

export type {
  LazySurfaceComponent,
  LazySurfaceOptions,
} from '@/components/lazy-surface-contract'

export function createLazySurface<Props extends object>(
  loader: () => LazyModule<Props>,
  options: LazySurfaceOptions<Props>,
): LazySurfaceComponent<Props> {
  let prefetchPromise: Promise<void> | null = null
  const InitialLazyComponent = lazy(loader)

  const RetryableLazySurface = ((props: Props) => createElement(LazySurfaceView<Props>, {
    initialComponent: InitialLazyComponent,
    loader,
    options,
    surfaceProps: props,
  })) as LazySurfaceComponent<Props>

  RetryableLazySurface.displayName = `Lazy(${options.displayName})`
  RetryableLazySurface.prefetch = () => {
    if (!prefetchPromise) {
      prefetchPromise = loader()
        .then(() => undefined)
        .catch(() => {
          prefetchPromise = null
        })
    }
    return prefetchPromise
  }

  return RetryableLazySurface
}
