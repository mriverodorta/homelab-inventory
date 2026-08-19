import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { InventoryTag } from '@/types/inventory-metadata'
import { COLOR_STYLES } from './metadata-presentation'

export function TagsTable({
  tags,
  canManage,
  pending,
  onEdit,
  onArchive,
  onDelete,
  onMove,
}: {
  tags: readonly InventoryTag[]
  canManage: boolean
  pending: boolean
  onEdit: (tag: InventoryTag) => void
  onArchive: (tag: InventoryTag, archived: boolean) => void
  onDelete: (tag: InventoryTag) => void
  onMove: (tag: InventoryTag, direction: -1 | 1) => void
}) {
  if (tags.length === 0) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">No inventory tags have been defined.</div>
  const activeIds = tags.filter((tag) => !tag.archivedAt).map((tag) => tag.id)
  return (
    <div className="divide-y divide-border">
      {tags.map((tag) => {
        const activeIndex = activeIds.indexOf(tag.id)
        return (
        <div key={tag.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`size-3 shrink-0 rounded-full ${COLOR_STYLES[tag.colorToken]}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-foreground">{tag.name}</span>
              {tag.archivedAt ? <span className="text-xs font-semibold text-amber-700">Archived</span> : null}
            </span>
          </div>
          <div className="flex gap-1">
            {!tag.archivedAt ? (
              <>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${tag.name} up`} disabled={!canManage || pending || activeIndex === 0} onClick={() => onMove(tag, -1)}><ChevronUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${tag.name} down`} disabled={!canManage || pending || activeIndex === activeIds.length - 1} onClick={() => onMove(tag, 1)}><ChevronDown /></Button>
              </>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`${tag.name} actions`} disabled={!canManage || pending}><Ellipsis /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!tag.archivedAt ? <DropdownMenuItem onSelect={() => onEdit(tag)}><Pencil /> Edit</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => onArchive(tag, !tag.archivedAt)}>{tag.archivedAt ? <ArchiveRestore /> : <Archive />}{tag.archivedAt ? 'Restore' : 'Archive'}</DropdownMenuItem>
                {tag.archivedAt ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => onDelete(tag)}><Trash2 /> Delete permanently</DropdownMenuItem></> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        )
      })}
    </div>
  )
}
