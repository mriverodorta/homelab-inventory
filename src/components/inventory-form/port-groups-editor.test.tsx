import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortGroupsEditor } from './port-groups-editor'
import type { PortGroup } from './model'

afterEach(() => {
  cleanup()
})

const validGroup: PortGroup = {
  id: 1,
  count: 4,
  type: 'rj45',
  speed: '2.5G',
  role: 'access',
}

describe('PortGroupsEditor validation targeting', () => {
  it('marks the later invalid count instead of the first group count', () => {
    render(
      <PortGroupsEditor
        type="switch"
        groups={[
          validGroup,
          {
            id: 2,
            count: -1,
            type: 'sfp',
            speed: '10G',
            role: 'uplink',
          },
        ]}
        error="Port counts must be whole numbers from 0 to 128."
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Port group 1 count').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByLabelText('Port group 2 count').getAttribute('aria-invalid')).toBe('true')
  })

  it('marks the later invalid speed instead of any count control', () => {
    render(
      <PortGroupsEditor
        type="switch"
        groups={[
          validGroup,
          {
            id: 2,
            count: 2,
            type: 'sfp',
            speed: '',
            role: 'uplink',
          },
        ]}
        error="Select a supported speed for the SFP+ switch port group."
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Port group 1 count').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByLabelText('Port group 2 count').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByLabelText('Port group 1 speed').getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.getByLabelText('Port group 2 speed').getAttribute('aria-invalid')).toBe('true')
  })
})
