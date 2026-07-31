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
  duplicateInventoryItem,
  loadInventoryDependencyReports,
  restoreInventoryItems,
  updateInventoryItem,
  updateInventoryItemProperties,
  type InventoryItemInput,
} from '@/lib/db'
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

type InventoryLifecycleRequest = {
  action: InventoryLifecycleAction
  items: InventoryItem[]
}

type PendingNasPowerChange = {
  nasId: number
  target: NasPowerConfiguration
  impact: NasPowerConfigurationImpact
}

type ApplyInventorySnapshot = (
  nextProject: ProjectState,
  options?: { historySnapshot?: ProjectState },
) => Promise<ProjectState>

type UseInventoryLifecycleOptions = {
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
}

export function useInventoryLifecycle({
  projectRef,
  applyInventorySnapshot,
  validateCanvasPlacement,
  createPrivateTemplate,
  setSelectedItemId,
  setPersistenceWarning,
  showMessage,
  showSuccessMessage,
}: UseInventoryLifecycleOptions) {
  const [request, setRequest] = useState<InventoryLifecycleRequest | null>(null)
  const [dependencyReport, setDependencyReport] = useState<InventoryDependencyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pendingNasPowerChange, setPendingNasPowerChange] = useState<PendingNasPowerChange | null>(null)
  const [nasPowerChangeBusy, setNasPowerChangeBusy] = useState(false)
  const [nasPowerChangeError, setNasPowerChangeError] = useState<string | null>(null)

  async function createItem(item: InventoryItemInput, quantity: number) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryItems(item, quantity)
    const previousItemIds = new Set(Object.keys(currentProject?.items ?? {}))
    const createdItemId = Object.keys(nextProject.items).find((itemId) => !previousItemIds.has(itemId))

    await applyInventorySnapshot(nextProject)
    if (createdItemId) setSelectedItemId(createdItemId)
  }

  async function createCatalogItem(templateKey: string, quantity: number) {
    const currentProject = projectRef.current
    const nextProject = await createInventoryFromCatalog(templateKey, quantity)
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

    const nextProject = await updateInventoryItem(
      { type: currentItem.type, id: currentItem.id },
      input,
    )
    await applyInventorySnapshot(nextProject, { historySnapshot: currentProject })
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

    const nextProject = await updateInventoryItemProperties(
      { type: currentItem.type, id: currentItem.id },
      properties,
    )
    await applyInventorySnapshot(nextProject, { historySnapshot: currentProject })
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
      const result = await changeNasPowerConfiguration(item.id, target, false)
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
      const result = await changeNasPowerConfiguration(pending.nasId, pending.target, true)
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
      const nextProject = await duplicateInventoryItem(inventoryRef(item))
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
      const reports = await loadInventoryDependencyReports(items.map(inventoryRef))
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
        ? await archiveInventoryItems(refs)
        : await deleteInventoryItems(refs)
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
      const nextProject = await restoreInventoryItems(items.map(inventoryRef))
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
    const nextProject = await applyCatalogUpdate(linkId)
    await applyInventorySnapshot(nextProject, { historySnapshot: currentProject ?? undefined })
  }

  return {
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
    dismissAction: () => {
      setRequest(null)
      setDependencyReport(null)
      setError(null)
    },
    dismissNasPowerChange: () => setPendingNasPowerChange(null),
  }
}
