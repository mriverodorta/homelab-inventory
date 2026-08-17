import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function SystemsSaveViewDialog({
  open,
  title,
  description,
  initialName = '',
  busy = false,
  error = null,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  title: string
  description: string
  initialName?: string
  busy?: boolean
  error?: string | null
  onOpenChange(open: boolean): void
  onSubmit(name: string): void
}) {
  const [name, setName] = useState(initialName)
  useEffect(() => { if (open) setName(initialName) }, [initialName, open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(name) }}>
          <label className="text-xs font-semibold text-[#4d4740]" htmlFor="systems-view-name">View name</label>
          <Input id="systems-view-name" className="mt-2" autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving...' : 'Save view'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
