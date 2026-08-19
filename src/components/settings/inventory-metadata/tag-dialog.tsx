import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { inventoryMetadataColorTokens, type InventoryMetadataColorToken, type InventoryTag } from '@/types/inventory-metadata'
import { COLOR_STYLES } from './metadata-presentation'

export function TagDialog({
  open,
  tag,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  tag: InventoryTag | null
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: { name: string; colorToken: InventoryMetadataColorToken }) => void
}) {
  const [name, setName] = useState('')
  const [colorToken, setColorToken] = useState<InventoryMetadataColorToken>('gray')
  useEffect(() => {
    if (!open) return
    setName(tag?.name ?? '')
    setColorToken(tag?.colorToken ?? 'gray')
  }, [open, tag])

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tag ? 'Edit tag' : 'New tag'}</DialogTitle>
          <DialogDescription>Create a reusable private label for inventory records.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-bold">Name<Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-bold">
            Color
            <Select value={colorToken} onValueChange={(value) => setColorToken(value as InventoryMetadataColorToken)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {inventoryMetadataColorTokens.map((color) => (
                  <SelectItem key={color} value={color}>
                    <span className="flex items-center gap-2 capitalize"><span className={`size-2.5 rounded-full ${COLOR_STYLES[color]}`} />{color}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {error ? <p role="alert" className="text-sm font-semibold text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={() => onSubmit({ name, colorToken })} disabled={!name.trim() || pending}>{pending ? 'Saving…' : 'Save tag'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
