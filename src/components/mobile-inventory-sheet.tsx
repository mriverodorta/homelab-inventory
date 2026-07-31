import { InventorySidebar, type InventorySidebarProps } from '@/components/inventory-sidebar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

export type MobileInventorySheetProps = Omit<
  InventorySidebarProps,
  'className' | 'onClose' | 'width'
> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MobileInventorySheet({
  open,
  onOpenChange,
  ...inventoryProps
}: MobileInventorySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="!w-[min(94vw,430px)] max-w-none gap-0 border-r-0 bg-[#20242c] p-0 text-[#f7f1e8] sm:max-w-none"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Inventory</SheetTitle>
          <SheetDescription>Browse and drag inventory items onto the canvas.</SheetDescription>
        </SheetHeader>
        <InventorySidebar
          {...inventoryProps}
          onClose={() => onOpenChange(false)}
          className="h-full w-full"
        />
      </SheetContent>
    </Sheet>
  )
}
