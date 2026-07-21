import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExpansionSlotGroupsEditor,
  StorageSlotGroupsEditor,
} from './resource-group-editor'
import type {
  ExpansionSlotGroupDraft,
  StorageSlotGroupDraft,
} from './model'

afterEach(() => {
  cleanup()
})

const validStorageGroup: StorageSlotGroupDraft = {
  draftKey: 'storage-1',
  id: 1,
  key: 'primary-m2',
  label: 'Primary M.2',
  count: '1',
  interfaces: ['NVMe'],
  formFactors: ['2280'],
  pcieGeneration: '4',
}

const validExpansionGroup: ExpansionSlotGroupDraft = {
  draftKey: 'expansion-1',
  id: 1,
  key: 'primary-pcie',
  label: 'Primary PCIe slot',
  count: '1',
  interfaceFamily: 'PCIe',
  pcieGeneration: '4',
  mechanicalLanes: '16',
  electricalLanes: '16',
  acceptedHeights: ['Full height'],
  maxSlotWidth: '2',
  maxPowerWatts: '75',
}

describe('resource group validation targeting', () => {
  it('marks the later invalid storage count instead of the first group count', () => {
    render(
      <StorageSlotGroupsEditor
        groups={[
          validStorageGroup,
          {
            ...validStorageGroup,
            draftKey: 'storage-2',
            id: 2,
            key: 'secondary-m2',
            label: 'Secondary M.2',
            count: '0',
          },
        ]}
        error="Storage slot counts must be whole numbers of at least 1."
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Storage group 1 count').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByLabelText('Storage group 2 count').getAttribute('aria-invalid')).toBe('true')
  })

  it('marks the later invalid expansion count instead of the first group count', () => {
    render(
      <ExpansionSlotGroupsEditor
        groups={[
          validExpansionGroup,
          {
            ...validExpansionGroup,
            draftKey: 'expansion-2',
            id: 2,
            key: 'secondary-pcie',
            label: 'Secondary PCIe slot',
            count: '0',
          },
        ]}
        error="Expansion slot counts must be whole numbers of at least 1."
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Expansion group 1 count').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByLabelText('Expansion group 2 count').getAttribute('aria-invalid')).toBe('true')
  })
})
