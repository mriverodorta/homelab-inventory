import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InspectorInventoryMetadataContext } from '@/components/inspector/inspector-inventory-metadata-context'
import { InspectorTabs } from '@/components/inspector/inspector-tabs'
import { renderWithOpenAuth } from '@/test/open-auth-test-render'

const editor = vi.hoisted(() => vi.fn(({ enabled }: { enabled: boolean }) => (
  <div data-testid="metadata-editor">{enabled ? 'Metadata active' : 'Metadata idle'}</div>
)))

vi.mock('@/components/inventory-metadata/inventory-item-metadata-editor', () => ({
  InventoryItemMetadataEditor: editor,
}))

describe('Inspector metadata tab', () => {
  it('keeps metadata disabled until the user selects its shared inspector tab', async () => {
    const user = userEvent.setup()
    renderWithOpenAuth(
      <InspectorInventoryMetadataContext.Provider value={{ projectId: 1, item: { type: 'server', id: 7 }, canEdit: true }}>
        <InspectorTabs tabs={[{ value: 'specs', label: 'Specs', content: <div>Server specs</div> }]} />
      </InspectorInventoryMetadataContext.Provider>,
    )

    expect(screen.getByRole('tab', { name: 'Metadata' })).toBeInTheDocument()
    expect(screen.queryByTestId('metadata-editor')).not.toBeInTheDocument()
    expect(editor).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'Metadata' }))

    expect(screen.getByTestId('metadata-editor')).toHaveTextContent('Metadata active')
  })
})
