import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppNavigationActions } from '@/app/use-app-navigation-actions'

function options() {
  return {
    setSelectedItemId: vi.fn(),
    setSelectedConnectionId: vi.fn(),
    clearPendingConnection: vi.fn(),
    clearNetworkTrace: vi.fn(),
    focusCanvasItem: vi.fn(),
    setAuditOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setDesktopInventoryVisible: vi.fn(),
    setMobileInventoryOpen: vi.fn(),
    updateStatusAvailable: false,
    refreshUpdateStatus: vi.fn(async () => false),
    setUpdateDialogOpen: vi.fn(),
  }
}

describe('useAppNavigationActions', () => {
  it('closes the inspector selection before opening the audit drawer', () => {
    const input = options()
    const { result } = renderHook(() => useAppNavigationActions(input))

    act(() => result.current.openAudit())

    expect(input.setSelectedItemId).toHaveBeenCalledWith(null)
    expect(input.setSelectedConnectionId).toHaveBeenCalledWith(null)
    expect(input.clearPendingConnection).toHaveBeenCalledTimes(1)
    expect(input.clearNetworkTrace).toHaveBeenCalledTimes(1)
    expect(input.setAuditOpen).toHaveBeenCalledWith(true)
  })

  it('closes the audit drawer when selecting one of its findings', () => {
    const input = options()
    const { result } = renderHook(() => useAppNavigationActions(input))

    act(() => result.current.selectAuditItem('server:1'))

    expect(input.setSelectedItemId).toHaveBeenCalledWith('server:1')
    expect(input.setAuditOpen).toHaveBeenCalledWith(false)
  })
})
