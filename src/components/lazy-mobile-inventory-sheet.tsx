import { useEffect, useState } from 'react'
import { createLazySurface } from '@/components/lazy-surface'
import type { MobileInventorySheetProps } from '@/components/mobile-inventory-sheet'

const mobileInventorySheetLoader = () => import('@/components/mobile-inventory-sheet').then((module) => ({
  default: module.MobileInventorySheet,
}))

const MobileInventorySheetSurface = createLazySurface<MobileInventorySheetProps>(
  mobileInventorySheetLoader,
  {
    displayName: 'Mobile inventory',
    loadingLabel: 'Loading inventory',
    loadingClassName: 'fixed inset-0 z-50 min-h-dvh w-screen rounded-none border-0 bg-[#20242c] text-[#f7f1e8]',
    getClose: (props) => () => props.onOpenChange(false),
  },
)

export function MobileInventorySheet(props: MobileInventorySheetProps) {
  const [hasOpened, setHasOpened] = useState(props.open)

  useEffect(() => {
    if (props.open) setHasOpened(true)
  }, [props.open])

  if (!hasOpened && !props.open) return null

  return <MobileInventorySheetSurface {...props} />
}
