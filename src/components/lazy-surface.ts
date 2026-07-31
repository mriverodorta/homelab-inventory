import { createElement } from 'react'
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

  const RetryableLazySurface = ((props: Props) => createElement(LazySurfaceView<Props>, {
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
