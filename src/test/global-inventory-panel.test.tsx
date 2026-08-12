import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GlobalInventoryPanel } from '@/components/inventory/global-inventory-panel'
import * as db from '@/lib/db'

vi.mock('@/lib/db', async (loadOriginal) => ({
  ...(await loadOriginal<typeof import('@/lib/db')>()),
  loadAvailableGlobalInventory: vi.fn(),
}))

function renderPanel(onAdd = vi.fn(async () => undefined)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <GlobalInventoryPanel projectId={2} enabled onAdd={onAdd} />
    </QueryClientProvider>,
  )
  return onAdd
}

describe('GlobalInventoryPanel', () => {
  it('searches eligible global items and adds one explicitly', async () => {
    vi.mocked(db.loadAvailableGlobalInventory).mockResolvedValue([
      { id: 3, type: 'cpu', name: 'Intel Core i5-10500T', manufacturer: 'Intel', model: 'i5-10500T', scope: 'global' },
      { id: 4, type: 'cpu', name: 'AMD Ryzen 5 5600G', manufacturer: 'AMD', model: '5600G', scope: 'global' },
    ])
    const onAdd = renderPanel()
    await screen.findByText('Intel Core i5-10500T')
    fireEvent.change(screen.getByPlaceholderText('Search global inventory'), { target: { value: '5600G' } })
    expect(screen.queryByText('Intel Core i5-10500T')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 4, type: 'cpu' })))
  })

  it('explains when the project opts out', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GlobalInventoryPanel projectId={2} enabled={false} onAdd={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Enable global inventory in Project settings/i)).toBeInTheDocument()
  })
})
