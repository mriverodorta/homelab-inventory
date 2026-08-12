import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import {
  DEFAULT_UI_PREFERENCES,
  getStoredAutoCenterOnSelect,
  getStoredAvoidCableCollisionsGlobally,
  getStoredDisplayCablesVisible,
  getStoredInventoryVisible,
  getStoredInventoryWidth,
  getStoredNetworkCablesVisible,
  getStoredOpenCreatedConnectionInspector,
  getStoredPowerCablesVisible,
  getStoredSnapCablesToGrid,
  getStoredSnapItemsToGrid,
  resetStoredUiPreferences,
  storeAutoCenterOnSelect,
  storeAvoidCableCollisionsGlobally,
  storeDisplayCablesVisible,
  storeInventoryVisible,
  storeInventoryWidth,
  storeNetworkCablesVisible,
  storeOpenCreatedConnectionInspector,
  storePowerCablesVisible,
  storeSnapCablesToGrid,
  storeSnapItemsToGrid,
} from '@/lib/ui-preferences'
import type { CanvasWorkspaceSettings, WorkspaceSummary } from '@/lib/workbook-api'

export const DEFAULT_CANVAS_WORKSPACE_SETTINGS: CanvasWorkspaceSettings = {
  networkCablesVisible: true,
  powerCablesVisible: true,
  displayCablesVisible: true,
  snapCablesToGrid: false,
  avoidCableCollisionsGlobally: false,
  snapItemsToGrid: false,
}

type UseWorkspacePreferencesOptions = {
  workspace?: WorkspaceSummary | null
  onWorkspaceSettingsChange?(settings: Partial<CanvasWorkspaceSettings>): Promise<unknown> | void
  onWorkspaceViewportChange?(viewport: { x: number; y: number; zoom: number }): Promise<unknown> | void
}

function legacyCanvasSettings(): CanvasWorkspaceSettings {
  return {
    networkCablesVisible: getStoredNetworkCablesVisible(),
    powerCablesVisible: getStoredPowerCablesVisible(),
    displayCablesVisible: getStoredDisplayCablesVisible(),
    snapCablesToGrid: getStoredSnapCablesToGrid(),
    avoidCableCollisionsGlobally: getStoredAvoidCableCollisionsGlobally(),
    snapItemsToGrid: getStoredSnapItemsToGrid(),
  }
}

function settingsForWorkspace(workspace?: WorkspaceSummary | null): CanvasWorkspaceSettings {
  const persisted = workspace?.settings ?? {}
  const fallback = workspace?.projectId === 1 && workspace.id === 2 && Object.keys(persisted).length === 0
    ? legacyCanvasSettings()
    : DEFAULT_CANVAS_WORKSPACE_SETTINGS
  return Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => [
      key,
      typeof persisted[key] === 'boolean' ? persisted[key] : value,
    ]),
  ) as CanvasWorkspaceSettings
}

export function useWorkspacePreferences({
  workspace = null,
  onWorkspaceSettingsChange,
  onWorkspaceViewportChange,
}: UseWorkspacePreferencesOptions = {}) {
  const scoped = Boolean(workspace && onWorkspaceSettingsChange)
  const [inventoryWidth, setInventoryWidth] = useState(getStoredInventoryWidth)
  const [desktopInventoryVisible, setDesktopInventoryVisible] = useState(getStoredInventoryVisible)
  const [autoCenterOnSelect, setAutoCenterOnSelect] = useState(getStoredAutoCenterOnSelect)
  const [openCreatedConnectionInspector, setOpenCreatedConnectionInspector] = useState(
    getStoredOpenCreatedConnectionInspector,
  )
  const [canvasSettings, setCanvasSettingsState] = useState(() => (
    scoped ? settingsForWorkspace(workspace) : legacyCanvasSettings()
  ))
  const canvasSettingsRef = useRef(canvasSettings)
  canvasSettingsRef.current = canvasSettings
  const importedWorkspaceRef = useRef<number | null>(null)
  const onWorkspaceSettingsChangeRef = useRef(onWorkspaceSettingsChange)
  onWorkspaceSettingsChangeRef.current = onWorkspaceSettingsChange
  const onWorkspaceViewportChangeRef = useRef(onWorkspaceViewportChange)
  onWorkspaceViewportChangeRef.current = onWorkspaceViewportChange

  useEffect(() => storeAutoCenterOnSelect(autoCenterOnSelect), [autoCenterOnSelect])
  useEffect(
    () => storeOpenCreatedConnectionInspector(openCreatedConnectionInspector),
    [openCreatedConnectionInspector],
  )
  useEffect(() => storeInventoryVisible(desktopInventoryVisible), [desktopInventoryVisible])
  useEffect(() => storeInventoryWidth(inventoryWidth), [inventoryWidth])
  useEffect(() => {
    if (scoped) return
    storeNetworkCablesVisible(canvasSettings.networkCablesVisible)
    storePowerCablesVisible(canvasSettings.powerCablesVisible)
    storeDisplayCablesVisible(canvasSettings.displayCablesVisible)
    storeSnapCablesToGrid(canvasSettings.snapCablesToGrid)
    storeAvoidCableCollisionsGlobally(canvasSettings.avoidCableCollisionsGlobally)
    storeSnapItemsToGrid(canvasSettings.snapItemsToGrid)
  }, [canvasSettings, scoped])

  useEffect(() => {
    if (!scoped || !workspace) return
    const resolved = settingsForWorkspace(workspace)
    canvasSettingsRef.current = resolved
    setCanvasSettingsState(resolved)
    if (
      workspace.projectId === 1
      && workspace.id === 2
      && Object.keys(workspace.settings ?? {}).length === 0
      && importedWorkspaceRef.current !== workspace.id
    ) {
      importedWorkspaceRef.current = workspace.id
      void Promise.resolve(onWorkspaceSettingsChangeRef.current?.(resolved)).catch(() => {})
    }
  }, [scoped, workspace])

  const setCanvasSetting = useCallback(<Key extends keyof CanvasWorkspaceSettings>(
    key: Key,
    action: SetStateAction<CanvasWorkspaceSettings[Key]>,
  ) => {
    const current = canvasSettingsRef.current
    const nextValue = typeof action === 'function'
      ? (action as (value: CanvasWorkspaceSettings[Key]) => CanvasWorkspaceSettings[Key])(current[key])
      : action
    if (nextValue === current[key]) return
    const next = { ...current, [key]: nextValue }
    canvasSettingsRef.current = next
    setCanvasSettingsState(next)
    if (scoped) {
      void Promise.resolve(onWorkspaceSettingsChangeRef.current?.({ [key]: nextValue })).catch(() => {})
    }
  }, [scoped])

  const resetWorkspacePreferences = useCallback(() => {
    resetStoredUiPreferences()
    setDesktopInventoryVisible(DEFAULT_UI_PREFERENCES.inventoryVisible)
    setInventoryWidth(DEFAULT_UI_PREFERENCES.inventoryWidth)
    setAutoCenterOnSelect(DEFAULT_UI_PREFERENCES.autoCenterOnSelect)
    setOpenCreatedConnectionInspector(DEFAULT_UI_PREFERENCES.openCreatedConnectionInspector)
    canvasSettingsRef.current = DEFAULT_CANVAS_WORKSPACE_SETTINGS
    setCanvasSettingsState(DEFAULT_CANVAS_WORKSPACE_SETTINGS)
    if (scoped) {
      void Promise.resolve(onWorkspaceSettingsChangeRef.current?.(DEFAULT_CANVAS_WORKSPACE_SETTINGS)).catch(() => {})
    }
  }, [scoped])

  return {
    inventoryWidth,
    setInventoryWidth,
    desktopInventoryVisible,
    setDesktopInventoryVisible,
    autoCenterOnSelect,
    setAutoCenterOnSelect,
    openCreatedConnectionInspector,
    setOpenCreatedConnectionInspector,
    networkCablesVisible: canvasSettings.networkCablesVisible,
    setNetworkCablesVisible: (action: SetStateAction<boolean>) => setCanvasSetting('networkCablesVisible', action),
    powerCablesVisible: canvasSettings.powerCablesVisible,
    setPowerCablesVisible: (action: SetStateAction<boolean>) => setCanvasSetting('powerCablesVisible', action),
    displayCablesVisible: canvasSettings.displayCablesVisible,
    setDisplayCablesVisible: (action: SetStateAction<boolean>) => setCanvasSetting('displayCablesVisible', action),
    snapCablesToGrid: canvasSettings.snapCablesToGrid,
    setSnapCablesToGrid: (action: SetStateAction<boolean>) => setCanvasSetting('snapCablesToGrid', action),
    avoidCableCollisionsGlobally: canvasSettings.avoidCableCollisionsGlobally,
    setAvoidCableCollisionsGlobally: (action: SetStateAction<boolean>) => setCanvasSetting('avoidCableCollisionsGlobally', action),
    snapItemsToGrid: canvasSettings.snapItemsToGrid,
    setSnapItemsToGrid: (action: SetStateAction<boolean>) => setCanvasSetting('snapItemsToGrid', action),
    initialViewport: workspace?.settings?.viewportPersisted === true
      && typeof workspace.viewportX === 'number'
      && typeof workspace.viewportY === 'number'
      && typeof workspace.viewportZoomBasisPoints === 'number'
      ? {
          x: workspace.viewportX,
          y: workspace.viewportY,
          zoom: workspace.viewportZoomBasisPoints / 10_000,
        }
      : null,
    persistViewport: (viewport: { x: number; y: number; zoom: number }) => {
      if (!scoped) return
      void Promise.resolve(onWorkspaceViewportChangeRef.current?.(viewport)).catch(() => {})
    },
    resetWorkspacePreferences,
  }
}
