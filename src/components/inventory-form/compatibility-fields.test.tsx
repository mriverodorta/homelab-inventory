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

    expect(screen.getByRole('heading', { name: 'Processor support' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Memory support' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add storage slot group' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Total expansion power (W)')).not.toBeInTheDocument()
  })

  it('keeps host resources focused on storage and expansion controls', () => {
    render(<HostResourceFields {...props} />)

    expect(screen.getByRole('button', { name: 'Add storage slot group' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add expansion slot group' })).toBeInTheDocument()
    expect(screen.getByLabelText('Total expansion power (W)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Supported CPU sockets')).not.toBeInTheDocument()
  })

  it('preserves the complete compatibility wrapper for host inspectors', () => {
    render(<CompatibilityFields {...props} />)

    expect(screen.getByRole('heading', { name: 'Compatibility' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Processor support' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Memory support' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Host resources' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add storage slot group' })).toBeInTheDocument()
  })
})
