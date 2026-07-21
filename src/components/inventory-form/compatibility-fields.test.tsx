import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CompatibilityFields,
  HostRequirementFields,
  HostResourceFields,
} from './compatibility-fields'
import { createInventoryFormValues } from './model'

afterEach(() => {
  cleanup()
})

const props = {
  values: createInventoryFormValues('server'),
  errors: {},
  onChange: vi.fn(),
}

describe('compatibility field groups', () => {
  it('keeps host requirements focused on processor and memory support', () => {
    render(<HostRequirementFields {...props} />)

    expect(screen.getByRole('heading', { name: 'Processor support' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Memory support' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add storage slot group' })).toBeNull()
    expect(screen.queryByLabelText('Total expansion power (W)')).toBeNull()
  })

  it('keeps host resources focused on storage and expansion controls', () => {
    render(<HostResourceFields {...props} />)

    expect(screen.getByRole('button', { name: 'Add storage slot group' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add expansion slot group' })).toBeTruthy()
    expect(screen.getByLabelText('Total expansion power (W)')).toBeTruthy()
    expect(screen.queryByLabelText('Supported CPU sockets')).toBeNull()
  })

  it('preserves the complete compatibility wrapper for host inspectors', () => {
    render(<CompatibilityFields {...props} />)

    expect(screen.getByRole('heading', { name: 'Compatibility' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Processor support' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Memory support' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Host resources' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add storage slot group' })).toBeTruthy()
  })
})
