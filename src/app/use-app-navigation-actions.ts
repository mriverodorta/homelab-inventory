import { useCallback } from 'react'

interface AppNavigationActionsOptions {
  setSelectedItemId(itemId: string | null): void
  setSelectedConnectionId(connectionId: string | number | null): void
  clearPendingConnection(): void
  clearNetworkTrace(): void
  focusCanvasItem(itemId: string): void
  setAuditOpen(open: boolean): void
  setSettingsOpen(open: boolean): void
  setDesktopInventoryVisible(update: (current: boolean) => boolean): void
  setMobileInventoryOpen(open: boolean): void
  desktopLayout: boolean
  updateStatusAvailable: boolean
  refreshUpdateStatus(): Promise<boolean>
  setUpdateDialogOpen(open: boolean): void
}

export function useAppNavigationActions({
  setSelectedItemId,
  setSelectedConnectionId,
  clearPendingConnection,
  clearNetworkTrace,
  focusCanvasItem,
  setAuditOpen,
  setSettingsOpen,
  setDesktopInventoryVisible,
  setMobileInventoryOpen,
  desktopLayout,
  updateStatusAvailable,
  refreshUpdateStatus,
  setUpdateDialogOpen,
}: AppNavigationActionsOptions) {
  const selectCanvasItemFromOverlay = useCallback((itemId: string) => {
    setSelectedItemId(itemId)
    setSelectedConnectionId(null)
    clearPendingConnection()
    clearNetworkTrace()
    focusCanvasItem(itemId)
  }, [clearNetworkTrace, clearPendingConnection, focusCanvasItem, setSelectedConnectionId, setSelectedItemId])

  const selectAuditItem = useCallback((itemId: string) => {
    selectCanvasItemFromOverlay(itemId)
    setAuditOpen(false)
  }, [selectCanvasItemFromOverlay, setAuditOpen])

  const clearCanvasSelection = useCallback(() => {
    setSelectedItemId(null)
    setSelectedConnectionId(null)
    clearPendingConnection()
  }, [clearPendingConnection, setSelectedConnectionId, setSelectedItemId])

  const openInventory = useCallback(() => {
    if (desktopLayout) {
      setDesktopInventoryVisible((current) => !current)
      return
    }
    setMobileInventoryOpen(true)
  }, [desktopLayout, setDesktopInventoryVisible, setMobileInventoryOpen])

  const openUpdate = useCallback(() => {
    if (updateStatusAvailable) {
      setUpdateDialogOpen(true)
      return
    }
    void refreshUpdateStatus().then((available) => {
      if (available) setUpdateDialogOpen(true)
    })
  }, [refreshUpdateStatus, setUpdateDialogOpen, updateStatusAvailable])

  const openAudit = useCallback(() => {
    clearCanvasSelection()
    clearNetworkTrace()
    setAuditOpen(true)
  }, [clearCanvasSelection, clearNetworkTrace, setAuditOpen])
  const openSettings = useCallback(() => setSettingsOpen(true), [setSettingsOpen])

  return {
    selectAuditItem,
    selectSearchItem: selectCanvasItemFromOverlay,
    clearCanvasSelection,
    openInventory,
    openUpdate,
    openAudit,
    openSettings,
  }
}
