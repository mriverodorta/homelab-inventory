import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermission } from '@/hooks/use-permission'
import { InventoryMetadataRequestError } from '@/lib/inventory-metadata-api'
import { useInventoryMetadataCatalog, useInventoryMetadataMutations } from '@/lib/inventory-metadata-query'
import type { CustomFieldDefinition, CustomFieldDefinitionInput, InventoryTag, InventoryTagInput } from '@/types/inventory-metadata'
import type { InventoryMetadataSettingsTab } from '@/types/settings-navigation'
import { SettingsSection } from '@/components/settings/settings-primitives'
import { CustomFieldDialog } from './custom-field-dialog'
import { CustomFieldsTable } from './custom-fields-table'
import { MetadataDeleteDialog } from './metadata-delete-dialog'
import { TagDialog } from './tag-dialog'
import { TagsTable } from './tags-table'

type DeleteTarget = { kind: 'field' | 'tag'; id: number; name: string } | null

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The metadata change could not be saved.'
}

export function InventoryMetadataSettings({
  requestedTab,
  requestId,
}: {
  requestedTab?: InventoryMetadataSettingsTab
  requestId?: number
} = {}) {
  const canManage = usePermission('inventory.metadata.manage')
  const [includeArchived, setIncludeArchived] = useState(false)
  const catalog = useInventoryMetadataCatalog({ includeArchived })
  const mutations = useInventoryMetadataMutations()
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null)
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [destructiveFieldUpdate, setDestructiveFieldUpdate] = useState<{
    definition: CustomFieldDefinition
    input: CustomFieldDefinitionInput
    itemCount: number
  } | null>(null)
  const [editingTag, setEditingTag] = useState<InventoryTag | null>(null)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<InventoryMetadataSettingsTab>(requestedTab ?? 'fields')
  const pending = Object.values(mutations).some((mutation) => mutation.isPending)
  const activeDefinitions = useMemo(() => catalog.data?.definitions.filter((definition) => !definition.archivedAt) ?? [], [catalog.data])
  const activeTags = useMemo(() => catalog.data?.tags.filter((tag) => !tag.archivedAt) ?? [], [catalog.data])

  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab)
  }, [requestId, requestedTab])

  function openField(definition: CustomFieldDefinition | null) {
    setEditingField(definition)
    setFieldError(null)
    setFieldDialogOpen(true)
  }

  async function saveField(input: CustomFieldDefinitionInput) {
    setFieldError(null)
    try {
      if (editingField) {
        await mutations.updateField.mutateAsync({ id: editingField.id, expectedRevision: editingField.revision, input })
      } else {
        await mutations.createField.mutateAsync(input)
      }
      setFieldDialogOpen(false)
    } catch (error) {
      if (editingField && error instanceof InventoryMetadataRequestError && error.status === 409) {
        const itemCount = Number((error.details as { itemCount?: unknown } | null)?.itemCount)
        if (Number.isSafeInteger(itemCount) && itemCount > 0) {
          setDestructiveFieldUpdate({ definition: editingField, input, itemCount })
          return
        }
      }
      setFieldError(errorMessage(error))
    }
  }

  async function confirmDestructiveFieldUpdate() {
    if (!destructiveFieldUpdate) return
    try {
      await mutations.updateField.mutateAsync({
        id: destructiveFieldUpdate.definition.id,
        expectedRevision: destructiveFieldUpdate.definition.revision,
        input: { ...destructiveFieldUpdate.input, deleteValuesForRemovedTypes: true },
      })
      setDestructiveFieldUpdate(null)
      setFieldDialogOpen(false)
    } catch (error) {
      setDestructiveFieldUpdate(null)
      setFieldError(errorMessage(error))
    }
  }

  function openTag(tag: InventoryTag | null) {
    setEditingTag(tag)
    setTagError(null)
    setTagDialogOpen(true)
  }

  async function saveTag(input: InventoryTagInput) {
    setTagError(null)
    try {
      if (editingTag) await mutations.updateTag.mutateAsync({ id: editingTag.id, expectedRevision: editingTag.revision, input })
      else await mutations.createTag.mutateAsync(input)
      setTagDialogOpen(false)
    } catch (error) {
      setTagError(errorMessage(error))
    }
  }

  async function archiveField(definition: CustomFieldDefinition, archived: boolean) {
    setPageError(null)
    try { await mutations.archiveField.mutateAsync({ id: definition.id, expectedRevision: definition.revision, archived }) }
    catch (error) { setPageError(errorMessage(error)) }
  }

  async function archiveTag(tag: InventoryTag, archived: boolean) {
    setPageError(null)
    try { await mutations.archiveTag.mutateAsync({ id: tag.id, expectedRevision: tag.revision, archived }) }
    catch (error) { setPageError(errorMessage(error)) }
  }

  async function moveField(definition: CustomFieldDefinition, direction: -1 | 1) {
    const ids = activeDefinitions.map((entry) => entry.id)
    const index = ids.indexOf(definition.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try { await mutations.reorderFields.mutateAsync(ids) } catch (error) { setPageError(errorMessage(error)) }
  }

  async function moveTag(tag: InventoryTag, direction: -1 | 1) {
    const ids = activeTags.map((entry) => entry.id)
    const index = ids.indexOf(tag.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try { await mutations.reorderTags.mutateAsync(ids) } catch (error) { setPageError(errorMessage(error)) }
  }

  async function confirmDelete(confirmationName: string) {
    if (!deleteTarget) return
    setDeleteError(null)
    try {
      if (deleteTarget.kind === 'field') await mutations.deleteField.mutateAsync({ id: deleteTarget.id, confirmationName })
      else await mutations.deleteTag.mutateAsync({ id: deleteTarget.id, confirmationName })
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(errorMessage(error))
    }
  }

  return (
    <SettingsSection title="Inventory metadata" description="Create private fields and reusable tags shared by this installation.">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-muted-foreground">Metadata stays local and is excluded from Registry contributions.</p>
          <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />Show archived</label>
        </div>
      </div>
      {pageError ? <p role="alert" className="border-b border-border px-4 py-3 text-sm font-semibold text-destructive">{pageError}</p> : null}
      {catalog.isPending ? <div className="min-h-52 animate-pulse bg-muted/30" aria-label="Loading inventory metadata" /> : null}
      {catalog.error ? <div className="px-4 py-10 text-center text-sm font-semibold text-destructive">{catalog.error.message}</div> : null}
      {catalog.data ? (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InventoryMetadataSettingsTab)}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <TabsList><TabsTrigger value="fields">Custom fields</TabsTrigger><TabsTrigger value="tags">Tags</TabsTrigger></TabsList>
          </div>
          <TabsContent value="fields" className="m-0">
            <div className="flex justify-end border-b border-border px-4 py-3">
              <Button type="button" size="sm" disabled={!canManage} onClick={() => openField(null)}><Plus /> New field</Button>
            </div>
            <CustomFieldsTable
              definitions={catalog.data.definitions}
              canManage={canManage}
              pending={pending}
              onEdit={openField}
              onArchive={(definition, archived) => void archiveField(definition, archived)}
              onDelete={(definition) => setDeleteTarget({ kind: 'field', id: definition.id, name: definition.name })}
              onMove={(definition, direction) => void moveField(definition, direction)}
            />
          </TabsContent>
          <TabsContent value="tags" className="m-0">
            <div className="flex justify-end border-b border-border px-4 py-3">
              <Button type="button" size="sm" disabled={!canManage} onClick={() => openTag(null)}><Plus /> New tag</Button>
            </div>
            <TagsTable
              tags={catalog.data.tags}
              canManage={canManage}
              pending={pending}
              onEdit={openTag}
              onArchive={(tag, archived) => void archiveTag(tag, archived)}
              onDelete={(tag) => setDeleteTarget({ kind: 'tag', id: tag.id, name: tag.name })}
              onMove={(tag, direction) => void moveTag(tag, direction)}
            />
          </TabsContent>
        </Tabs>
      ) : null}
      <CustomFieldDialog open={fieldDialogOpen} definition={editingField} pending={mutations.createField.isPending || mutations.updateField.isPending} error={fieldError} onOpenChange={setFieldDialogOpen} onSubmit={(input) => void saveField(input)} />
      <TagDialog open={tagDialogOpen} tag={editingTag} pending={mutations.createTag.isPending || mutations.updateTag.isPending} error={tagError} onOpenChange={setTagDialogOpen} onSubmit={(input) => void saveTag(input)} />
      <MetadataDeleteDialog target={deleteTarget} pending={mutations.deleteField.isPending || mutations.deleteTag.isPending} error={deleteError} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={(confirmation) => void confirmDelete(confirmation)} />
      <AlertDialog open={destructiveFieldUpdate !== null} onOpenChange={(open) => !open && setDestructiveFieldUpdate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove existing custom values?</AlertDialogTitle><AlertDialogDescription>Changing applicability will delete this field from {destructiveFieldUpdate?.itemCount ?? 0} inventory item{destructiveFieldUpdate?.itemCount === 1 ? '' : 's'}. Other metadata remains unchanged.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep current types</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={(event) => { event.preventDefault(); void confirmDestructiveFieldUpdate() }}>Delete values and save</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
