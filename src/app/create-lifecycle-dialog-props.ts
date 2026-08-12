import type { AppDialogsProps } from '@/app/app-dialogs'
import type { useCanvasEquipmentLifecycle } from '@/app/use-canvas-equipment-lifecycle'
import type { useInventoryLifecycle } from '@/app/use-inventory-lifecycle'
import type { ProjectState } from '@/types/inventory'

type LifecycleDialogProps = Pick<
  AppDialogsProps,
  'inventoryLifecycle' | 'inventoryScope' | 'returnToInventory' | 'nasPower' | 'assignmentRemoval'
>

interface CreateLifecycleDialogPropsOptions {
  project: ProjectState
  inventory: ReturnType<typeof useInventoryLifecycle>
  equipment: ReturnType<typeof useCanvasEquipmentLifecycle>
}

export function createLifecycleDialogProps({
  project,
  inventory,
  equipment,
}: CreateLifecycleDialogPropsOptions): LifecycleDialogProps {
  return {
    inventoryLifecycle: {
      open: inventory.request !== null,
      action: inventory.request?.action ?? 'archive',
      itemNames: inventory.request?.items.map((item) => item.name) ?? [],
      dependencyReport: inventory.dependencyReport,
      loading: inventory.busy,
      error: inventory.error,
      onOpenChange: (open) => {
        if (!open) inventory.dismissAction()
      },
      onConfirm: () => void inventory.confirmAction(),
    },
    inventoryScope: {
      open: inventory.pendingScopeAction !== null,
      action: inventory.pendingScopeAction?.action ?? 'make-global',
      itemName: inventory.pendingScopeAction?.item.name ?? 'Inventory item',
      activeProjectId: inventory.activeProjectId,
      projects: inventory.projects,
      busy: inventory.scopeActionBusy,
      error: inventory.scopeActionError,
      onOpenChange: (open) => {
        if (!open) inventory.dismissScopeAction()
      },
      onConfirm: (targetProjectId) => void inventory.confirmScopeAction(targetProjectId),
    },
    returnToInventory: {
      open: equipment.returnToInventoryItemId !== null,
      itemName: equipment.returnToInventoryItem?.name ?? 'Canvas item',
      itemType: equipment.returnToInventoryItem?.type ?? 'item',
      impact: equipment.returnToInventoryImpact ?? {
        placementsRemoved: 0,
        assignmentsReleased: 0,
        connectionsRemoved: 0,
      },
      busy: equipment.returnToInventoryBusy,
      onOpenChange: (open) => {
        if (!open) equipment.dismissReturnToInventory()
      },
      onConfirm: equipment.confirmReturnToInventory,
    },
    nasPower: {
      open: inventory.pendingNasPowerChange !== null,
      nasName: inventory.pendingNasPowerChange
        ? project.items[`nas:${inventory.pendingNasPowerChange.nasId}`]?.name ?? 'NAS'
        : 'NAS',
      impact: inventory.pendingNasPowerChange?.impact ?? null,
      busy: inventory.nasPowerChangeBusy,
      error: inventory.nasPowerChangeError,
      onOpenChange: (open) => {
        if (!open && !inventory.nasPowerChangeBusy) inventory.dismissNasPowerChange()
      },
      onConfirm: () => void inventory.confirmNasPowerConfigurationChange(),
    },
    assignmentRemoval: {
      open: equipment.pendingAssignmentRemoval !== null,
      itemName: equipment.pendingAssignmentRemoval?.itemName ?? 'component',
      connectionCount: equipment.pendingAssignmentRemoval?.connectionCount ?? 0,
      onOpenChange: (open) => {
        if (!open) equipment.dismissAssignmentRemoval()
      },
      onConfirm: equipment.confirmAssignmentRemoval,
    },
  }
}
