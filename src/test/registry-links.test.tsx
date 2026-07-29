import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RegistryLinkIndicator } from '@/components/registry-link-indicator'
import { buildVisibleRegistryLinkKeys } from '@/lib/registry-links'
import { DEFAULT_REGISTRY_STATE, type RegistryLink } from '@/types/registry'

function link(state: RegistryLink['state'], itemType: string, itemId: number): RegistryLink {
  return {
    id: itemId,
    itemType,
    itemId,
    sourceId: 1,
    templateKey: `template-${itemType}-${itemId}`,
    importedRevision: 1,
    importedContentHash: 'a'.repeat(64),
    state,
    linkedAt: '2026-07-29T00:00:00.000Z',
  }
}

describe('registry link indicators', () => {
  it('stays empty until the persisted preference is enabled', () => {
    expect(buildVisibleRegistryLinkKeys({
      ...DEFAULT_REGISTRY_STATE,
      links: [link('linked', 'cpu', 1)],
    })).toEqual(new Set())
  })

  it('includes linked and update-available records only', () => {
    const keys = buildVisibleRegistryLinkKeys({
      ...DEFAULT_REGISTRY_STATE,
      settings: { ...DEFAULT_REGISTRY_STATE.settings, showRegistryLinkIndicators: true },
      links: [
        link('linked', 'cpu', 1),
        link('update-available', 'ram', 2),
        link('detached', 'storage', 3),
        link('contribution-pending', 'network', 4),
      ],
    })

    expect(keys).toEqual(new Set(['cpu:1', 'ram:2']))
  })

  it('renders a noninteractive accessible marker only when visible', () => {
    const { rerender } = render(<RegistryLinkIndicator visible={false} />)
    expect(screen.queryByLabelText('Linked to the official registry')).not.toBeInTheDocument()

    rerender(<RegistryLinkIndicator visible />)
    expect(screen.getByLabelText('Linked to the official registry')).toHaveClass('pointer-events-none', 'opacity-50')
  })
})
