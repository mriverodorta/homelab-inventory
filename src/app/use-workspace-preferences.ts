import { useCallback, useEffect, useState } from 'react'
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

export function useWorkspacePreferences() {
  const [inventoryWidth, setInventoryWidth] = useState(getStoredInventoryWidth)
  const [desktopInventoryVisible, setDesktopInventoryVisible] = useState(getStoredInventoryVisible)
  const [autoCenterOnSelect, setAutoCenterOnSelect] = useState(getStoredAutoCenterOnSelect)
  const [networkCablesVisible, setNetworkCablesVisible] = useState(getStoredNetworkCablesVisible)
  const [powerCablesVisible, setPowerCablesVisible] = useState(getStoredPowerCablesVisible)
  const [displayCablesVisible, setDisplayCablesVisible] = useState(getStoredDisplayCablesVisible)
  const [openCreatedConnectionInspector, setOpenCreatedConnectionInspector] = useState(
    getStoredOpenCreatedConnectionInspector,
  )
  const [snapCablesToGrid, setSnapCablesToGrid] = useState(getStoredSnapCablesToGrid)
  const [avoidCableCollisionsGlobally, setAvoidCableCollisionsGlobally] = useState(
    getStoredAvoidCableCollisionsGlobally,
  )
  const [snapItemsToGrid, setSnapItemsToGrid] = useState(getStoredSnapItemsToGrid)

  useEffect(() => storeAutoCenterOnSelect(autoCenterOnSelect), [autoCenterOnSelect])
  useEffect(() => storeNetworkCablesVisible(networkCablesVisible), [networkCablesVisible])
  useEffect(() => storePowerCablesVisible(powerCablesVisible), [powerCablesVisible])
  useEffect(() => storeDisplayCablesVisible(displayCablesVisible), [displayCablesVisible])
  useEffect(
    () => storeOpenCreatedConnectionInspector(openCreatedConnectionInspector),
    [openCreatedConnectionInspector],
  )
  useEffect(() => storeSnapCablesToGrid(snapCablesToGrid), [snapCablesToGrid])
  useEffect(
    () => storeAvoidCableCollisionsGlobally(avoidCableCollisionsGlobally),
    [avoidCableCollisionsGlobally],
  )
  useEffect(() => storeSnapItemsToGrid(snapItemsToGrid), [snapItemsToGrid])
  useEffect(() => storeInventoryVisible(desktopInventoryVisible), [desktopInventoryVisible])
  useEffect(() => storeInventoryWidth(inventoryWidth), [inventoryWidth])

  const resetWorkspacePreferences = useCallback(() => {
    resetStoredUiPreferences()
    setDesktopInventoryVisible(DEFAULT_UI_PREFERENCES.inventoryVisible)
    setInventoryWidth(DEFAULT_UI_PREFERENCES.inventoryWidth)
    setAutoCenterOnSelect(DEFAULT_UI_PREFERENCES.autoCenterOnSelect)
    setNetworkCablesVisible(DEFAULT_UI_PREFERENCES.networkCablesVisible)
    setPowerCablesVisible(DEFAULT_UI_PREFERENCES.powerCablesVisible)
    setDisplayCablesVisible(DEFAULT_UI_PREFERENCES.displayCablesVisible)
    setOpenCreatedConnectionInspector(DEFAULT_UI_PREFERENCES.openCreatedConnectionInspector)
    setSnapCablesToGrid(DEFAULT_UI_PREFERENCES.snapCablesToGrid)
    setAvoidCableCollisionsGlobally(DEFAULT_UI_PREFERENCES.avoidCableCollisionsGlobally)
    setSnapItemsToGrid(DEFAULT_UI_PREFERENCES.snapItemsToGrid)
  }, [])

  return {
    inventoryWidth,
    setInventoryWidth,
    desktopInventoryVisible,
    setDesktopInventoryVisible,
    autoCenterOnSelect,
    setAutoCenterOnSelect,
    networkCablesVisible,
    setNetworkCablesVisible,
    powerCablesVisible,
    setPowerCablesVisible,
    displayCablesVisible,
    setDisplayCablesVisible,
    openCreatedConnectionInspector,
    setOpenCreatedConnectionInspector,
    snapCablesToGrid,
    setSnapCablesToGrid,
    avoidCableCollisionsGlobally,
    setAvoidCableCollisionsGlobally,
    snapItemsToGrid,
    setSnapItemsToGrid,
    resetWorkspacePreferences,
  }
}
