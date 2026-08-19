import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { InventoryLifecycleAction } from '@/components/inventory-lifecycle-dialog'
import {
  aggregateDependencyReports,
  inventoryRef,
} from '@/app/project-drop-helpers'
import {
  applyCatalogUpdate,
  createInventoryFromCatalog,
} from '@/lib/registry-api'
import {
  archiveInventoryItems,
  changeNasPowerConfiguration,
  createInventoryItems,
  deleteInventoryItems,
  duplicateInventoryToProject,
  duplicateInventoryItem,
  loadInventoryDependencyReports,
  removeGlobalInventoryFromProject,
  restoreInventoryItems,
  setInventoryItemScope,
  updateInventoryItem,
  updateInventoryItemProperties,
  type InventoryItemInput,
  type WorkspaceMutationScope,
} from '@/lib/db'
import type { ProjectSummary } from '@/lib/workbook-api'
import type { InventoryDependencyReport } from '@/lib/inventory-lifecycle'
import { runtimeItemKey } from '@/lib/item-keys'
import { getPowerEquipmentOrientation } from '@/lib/power-equipment-layout'
import type {
  InventoryItem,
  InventoryProperties,
  NasPowerConfiguration,
  NasPowerConfigurationImpact,
  ProjectState,
} from '@/types/inventory'
import type { InventoryItemMetadataInput } from '@/types/inventory-metadata'
import type { MutationEffects } from '@/types/domain-mutation'

type InventoryLifecycleRequest = {
  action: InventoryLifecycleAction
  items: InventoryItem[]
}

type PendingNasPowerChange = {
  nasId: number
  target: NasPowerConfiguration
  impact: NasPowerConfigurationImpact
}

export type InventoryScopeAction = 'make-global' | 'make-project-bound' | 'remove-from-project' | 'duplicate-to-project'

type PendingInventoryScopeAction = {
  action: InventoryScopeAction
  item: InventoryItem
}

type ApplyInventorySnapshot = (
  nextProject: ProjectState,
  options?: { historySnapshot?: ProjectState; effects?: MutationEffects },
) => Promise<ProjectState>

type UseInventoryLifecycleOptions = {
  scope: WorkspaceMutationScope | null
  projectRef: MutableRefObject<ProjectState | null>
  applyInventorySnapshot: ApplyInventorySnapshot
  validateCanvasPlacement: (
    project: ProjectState,
    placement: ProjectState['placements'][number],
  ) => Promise<{ valid: boolean } | null>
  createPrivateTemplate: (item: InventoryItem) => Promise<unknown>
  setSelectedItemId: Dispatch<SetStateAction<string | null>>
  setPersistenceWarning: Dispatch<SetStateAction<string | null>>
  showMessage: (message: string) => void
  showSuccessMessage: (message: string) => void
  activeProjectId: number
  projects: ProjectSummary[]
}

export function useInventoryLifecycle({
  scope,
  projectRef,
  applyInventorySnapshot,
  validateCanvasPlacement,
  createPrivateTemplate,
  setSelectedItemId,
  setPersistenceWarning,
  showMessage,
  showSuccessMessage,
  activeProjectId,
  projects,
}: UseInventoryLifecycleOptions) {
  const [request, setRequest] = useState<InventoryLifecycleRequest | null>(null)
  const [dependencyReport, setDependencyReport] = useState<InventoryDependencyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pendingNasPowerChange, setPendingNasPowerChange] = useState<PendingNasPowerChange | null>(null)
  const [nasPowerChangeBusy, setNasPowerChangeBusy] = useState(false)
  const [nasPowerChangeError, setNasPowerChangeError] = useState<string | null>(null)
  const [pendingScopeAction, setPendingScopeAction] = useState<PendingInventoryScopeAction | null>(null)
  const [scopeActionBusy, setScopeActionBusy] = useState(false)
  const [scopeActionError, setScopeActionError] = useState<string | null>(null)

  async function createItem(item: InventoryItemInput, quantity: number, metadata?: InventoryItemMetadataInput) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryItems(item, quantity, scope, metadata)
    const previousItemIds = new Set(Object.keys(currentProject?.items ?? {}))
    const createdItemId = Object.keys(nextProject.items).find((itemId) => !previousItemIds.has(itemId))

    await applyInventorySnapshot(nextProject)
    if (createdItemId) setSelectedItemId(createdItemId)
  }

  async function createCatalogItem(
    templateKey: string,
    quantity: number,
    usageRole: 'server' | 'desktop' | 'workstation' | 'other' = 'server',
  ) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryFromCatalog(templateKey, quantity, usageRole, scope)
    const previousItemIds = new Set(Object.keys(currentProject?.items ?? {}))
    const createdItemId = Object.keys(nextProject.items).find((itemId) => !previousItemIds.has(itemId))

    await applyInventorySnapshot(nextProject)
    if (createdItemId) setSelectedItemId(createdItemId)
  }

  async function savePrivateTemplate(item: InventoryItem) {
    try {
      await createPrivateTemplate(item)
      showSuccessMessage(`Saved ${item.name} as a private template.`)
    } catch (caughtError) {
      showMessage(caughtError instanceof Error ? caughtError.message : 'Private template could not be saved.')
    }
  }

  async function updateItem(itemId: string, input: InventoryItemInput) {
    const currentProject = projectRef.current
    const currentItem = currentProject?.items[itemId]
    if (!currentItem) throw new Error('Inventory item could not be found.')

    const result = await updateInventoryItem(
      { type: currentItem.type, id: currentItem.id },
      input,
      scope,
    )
    await applyInventorySnapshot(result.data, {
      historySnapshot: currentProject,
      effects: result.effects,
    })
  }

  async function updateItemProperties(itemId: string, properties: InventoryProperties) {
    const currentProject = projectRef.current
    const currentItem = currentProject?.items[itemId]
    if (!currentItem) throw new Error('Inventory item could not be found.')

    const projectedItem = { ...currentItem, properties }
    const orientationChanged = (currentItem.type === 'ups' || currentItem.type === 'powerStrip')
      && getPowerEquipmentOrientation(currentItem) !== getPowerEquipmentOrientation(projectedItem)
    const placement = currentProject.placements.find((candidate) => candidate.serverId === itemId)

    if (orientationChanged && placement) {
      const projectedProject: ProjectState = {
        ...currentProject,
        items: { ...currentProject.items, [itemId]: projectedItem },
      }
      const placementCheck = await validateCanvasPlacement(projectedProject, placement)
      if (!placementCheck) throw new Error('Canvas layout validation failed.')
      if (!placementCheck.valid) {
        throw new Error(
          'This orientation would overlap another canvas item. Move the surrounding equipment first.',
        )
      }
    }

    const result = await updateInventoryItemProperties(
      { type: currentItem.type, id: currentItem.id },
      properties,
      scope,
    )
    await applyInventorySnapshot(result.data, {
      historySnapshot: currentProject,
      effects: result.effects,
    })
  }

  async function requestNasPowerConfigurationChange(
    item: InventoryItem,
    target: NasPowerConfiguration,
  ) {
    const currentProject = projectRef.current
    if (!currentProject || item.type !== 'nas') return

    setNasPowerChangeBusy(true)
    setNasPowerChangeError(null)
    try {
      const result = await changeNasPowerConfiguration(item.id, target, false, scope)
      if (result.status === 'confirmation-required') {
        setPendingNasPowerChange({ nasId: item.id, target, impact: result.impact })
        return
      }
      await applyInventorySnapshot(result.project, { historySnapshot: currentProject })
    } catch (caughtError) {
      setPersistenceWarning(
        caughtError instanceof Error
          ? caughtError.message
          : 'NAS power configuration could not be changed.',
      )
    } finally {
      setNasPowerChangeBusy(false)
    }
  }

  async function confirmNasPowerConfigurationChange() {
    const pending = pendingNasPowerChange
    const currentProject = projectRef.current
    if (!pending || !currentProject) return

    setNasPowerChangeBusy(true)
    setNasPowerChangeError(null)
    try {
      const result = await changeNasPowerConfiguration(pending.nasId, pending.target, true, scope)
      if (result.status !== 'applied') {
        setPendingNasPowerChange({ ...pending, impact: result.impact })
        return
      }
      await applyInventorySnapshot(result.project, { historySnapshot: currentProject })
      setPendingNasPowerChange(null)
    } catch (caughtError) {
      setNasPowerChangeError(
        caughtError instanceof Error
          ? caughtError.message
          : 'NAS power configuration could not be changed.',
      )
    } finally {
      setNasPowerChangeBusy(false)
    }
  }

  async function duplicateItem(item: InventoryItem) {
    setBusy(true)
    setError(null)
    try {
      const currentItemIds = new Set(Object.keys(projectRef.current?.items ?? {}))
      const nextProject = await duplicateInventoryItem(inventoryRef(item), scope)
      const duplicatedItemId = Object.keys(nextProject.items).find((itemId) => !currentItemIds.has(itemId))

      await applyInventorySnapshot(nextProject)
      setRevision((current) => current + 1)
      if (duplicatedItemId) setSelectedItemId(duplicatedItemId)
    } catch (caughtError) {
      setPersistenceWarning(
        caughtError instanceof Error ? caughtError.message : 'Inventory item could not be duplicated.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function requestAction(action: InventoryLifecycleAction, items: InventoryItem[]) {
    if (items.length === 0) return

    setRequest({ action, items })
    setDependencyReport(null)
    setError(null)
    setBusy(true)
    try {
      const reports = await loadInventoryDependencyReports(items.map(inventoryRef), scope)
      setDependencyReport(aggregateDependencyReports(reports))
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Inventory dependencies could not be inspected.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmAction() {
    if (!request || !dependencyReport || dependencyReport.blocked) return

    setBusy(true)
    setError(null)
    try {
      const refs = request.items.map(inventoryRef)
      const nextProject = request.action === 'archive'
        ? await archiveInventoryItems(refs, scope)
        : await deleteInventoryItems(refs, scope)
      const affectedIds = new Set(request.items.map(runtimeItemKey))

      await applyInventorySnapshot(nextProject)
      setSelectedItemId((current) => current && affectedIds.has(current) ? null : current)
      setRevision((current) => current + 1)
      setRequest(null)
      setDependencyReport(null)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Inventory items could not be ${request.action}d.`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function restoreItems(items: InventoryItem[]) {
    if (items.length === 0) return

    setBusy(true)
    setError(null)
    try {
      const nextProject = await restoreInventoryItems(items.map(inventoryRef), scope)
      await applyInventorySnapshot(nextProject)
      setRevision((current) => current + 1)
    } catch (caughtError) {
      setPersistenceWarning(
        caughtError instanceof Error ? caughtError.message : 'Inventory items could not be restored.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function applyUpdate(linkId: number) {
    const currentProject = projectRef.current
    const nextProject = await applyCatalogUpdate(linkId, scope)
    await applyInventorySnapshot(nextProject, { historySnapshot: currentProject ?? undefined })
  }

  function requestScopeAction(action: InventoryScopeAction, item: InventoryItem) {
    setScopeActionError(null)
    setPendingScopeAction({ action, item })
  }

  async function confirmScopeAction(targetProjectId?: number) {
    const pending = pendingScopeAction
    const currentProject = projectRef.current
    if (!pending || !currentProject) return
    setScopeActionBusy(true)
    setScopeActionError(null)
    try {
      const ref = inventoryRef(pending.item)
      if (pending.action === 'duplicate-to-project') {
        if (!targetProjectId || targetProjectId === activeProjectId) {
          throw new Error('Choose another active project for the duplicate.')
        }
        const target = projects.find((project) => project.id === targetProjectId)
        if (!target) throw new Error('The target project is not available.')
        await duplicateInventoryToProject(targetProjectId, activeProjectId, ref)
        showSuccessMessage(`Duplicated ${pending.item.name} to ${target.name}.`)
      } else if (pending.action === 'remove-from-project') {
        const result = await removeGlobalInventoryFromProject(activeProjectId, ref)
        await applyInventorySnapshot(result.project, { historySnapshot: currentProject })
        setSelectedItemId((selected) => selected === runtimeItemKey(pending.item) ? null : selected)
        showSuccessMessage(`Removed ${pending.item.name} from this project.`)
      } else {
        const result = await setInventoryItemScope(ref, {
          scope: pending.action === 'make-global' ? 'global' : 'project',
          ...(pending.action === 'make-project-bound' ? { projectId: activeProjectId } : {}),
        })
        await applyInventorySnapshot(result.project, { historySnapshot: currentProject })
        showSuccessMessage(
          pending.action === 'make-global'
            ? `${pending.item.name} is now global inventory.`
            : `${pending.item.name} is now bound to this project.`,
        )
      }
      setPendingScopeAction(null)
      setRevision((current) => current + 1)
    } catch (caughtError) {
      setScopeActionError(caughtError instanceof Error ? caughtError.message : 'Inventory scope could not be changed.')
    } finally {
      setScopeActionBusy(false)
    }
  }

  return {
    activeProjectId,
    projects,
    request,
    dependencyReport,
    busy,
    error,
    revision,
    pendingNasPowerChange,
    nasPowerChangeBusy,
    nasPowerChangeError,
    createItem,
    createCatalogItem,
    savePrivateTemplate,
    updateItem,
    updateItemProperties,
    requestNasPowerConfigurationChange,
    confirmNasPowerConfigurationChange,
    duplicateItem,
    requestAction,
    confirmAction,
    restoreItems,
    applyUpdate,
    pendingScopeAction,
    scopeActionBusy,
    scopeActionError,
    requestScopeAction,
    confirmScopeAction,
    dismissScopeAction: () => {
      if (scopeActionBusy) return
      setPendingScopeAction(null)
      setScopeActionError(null)
    },
    dismissAction: () => {
      setRequest(null)
      setDependencyReport(null)
      setError(null)
    },
    dismissNasPowerChange: () => setPendingNasPowerChange(null),
  }
}
