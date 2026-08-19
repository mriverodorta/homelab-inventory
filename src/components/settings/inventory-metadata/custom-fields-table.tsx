import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CustomFieldDefinition } from '@/types/inventory-metadata'
import { FIELD_TYPE_LABELS } from './metadata-presentation'

export function CustomFieldsTable({
  definitions,
  canManage,
  pending,
  onEdit,
  onArchive,
  onDelete,
  onMove,
}: {
  definitions: readonly CustomFieldDefinition[]
  canManage: boolean
  pending: boolean
  onEdit: (definition: CustomFieldDefinition) => void
  onArchive: (definition: CustomFieldDefinition, archived: boolean) => void
  onDelete: (definition: CustomFieldDefinition) => void
  onMove: (definition: CustomFieldDefinition, direction: -1 | 1) => void
}) {
  if (definitions.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-muted-foreground">No custom fields have been defined.</div>
  }

  const activeIds = definitions.filter((definition) => !definition.archivedAt).map((definition) => definition.id)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr><th className="px-4 py-2 font-bold">Field</th><th className="px-3 py-2 font-bold">Type</th><th className="px-3 py-2 font-bold">Applies to</th><th className="w-28 px-4 py-2 text-right font-bold">Actions</th></tr>
        </thead>
        <tbody>
          {definitions.map((definition) => {
            const activeIndex = activeIds.indexOf(definition.id)
            return (
            <tr key={definition.id} className="border-t border-border align-middle">
              <td className="px-4 py-3">
                <div className="font-bold text-foreground">{definition.name}</div>
                {definition.description ? <div className="mt-0.5 max-w-md text-xs text-muted-foreground">{definition.description}</div> : null}
                {definition.archivedAt ? <div className="mt-1 text-xs font-semibold text-amber-700">Archived</div> : null}
              </td>
              <td className="px-3 py-3">{FIELD_TYPE_LABELS[definition.fieldType]}{definition.unit ? ` · ${definition.unit}` : ''}</td>
              <td className="px-3 py-3 text-muted-foreground">{definition.applicableItemTypes.length} type{definition.applicableItemTypes.length === 1 ? '' : 's'}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  {!definition.archivedAt ? (
                    <>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${definition.name} up`} disabled={!canManage || pending || activeIndex === 0} onClick={() => onMove(definition, -1)}><ChevronUp /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${definition.name} down`} disabled={!canManage || pending || activeIndex === activeIds.length - 1} onClick={() => onMove(definition, 1)}><ChevronDown /></Button>
                    </>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`${definition.name} actions`} disabled={!canManage || pending}><Ellipsis /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!definition.archivedAt ? <DropdownMenuItem onSelect={() => onEdit(definition)}><Pencil /> Edit</DropdownMenuItem> : null}
                      <DropdownMenuItem onSelect={() => onArchive(definition, !definition.archivedAt)}>{definition.archivedAt ? <ArchiveRestore /> : <Archive />}{definition.archivedAt ? 'Restore' : 'Archive'}</DropdownMenuItem>
                      {definition.archivedAt ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => onDelete(definition)}><Trash2 /> Delete permanently</DropdownMenuItem></> : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
