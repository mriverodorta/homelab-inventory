import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { M2AeCompatibilitySummary } from './m2-ae-compatibility-summary'

describe('M2AeCompatibilitySummary', () => {
  it('separates physical fit, required buses, and descriptive OEM intent', () => {
    render(<M2AeCompatibilitySummary
      resource={{
        id: 1,
        key: 'm2-ae-slot',
        keyAliases: ['wlan-m2'],
        label: 'M.2 Key E slot',
        count: 1,
        interfaceFamily: 'm2-ae',
        socketKeys: ['E'],
        moduleSizes: ['2230'],
        availableBuses: [{ family: 'pcie', lanes: 1, pcieGeneration: 3 }],
        intendedModuleKinds: ['wireless-card'],
      }}
      requirements={{
        key: 'A+E',
        moduleSize: '2230',
        requiredBuses: [{ family: 'pcie', minimumLanes: 1, minimumPcieGeneration: 2 }],
      }}
    />)

    expect(screen.getByText('Physical fit')).toBeInTheDocument()
    expect(screen.getByText('E key socket · 2230 module')).toBeInTheDocument()
    expect(screen.getByText('Required buses')).toBeInTheDocument()
    expect(screen.getByText(/PCIe · x1 minimum · Gen2 minimum · PCIe x1 Gen3/)).toBeInTheDocument()
    expect(screen.getByText('OEM intended use')).toBeInTheDocument()
    expect(screen.getByText('wireless-card (descriptive only)')).toBeInTheDocument()
  })

  it('labels missing bus evidence as unknown instead of incompatible', () => {
    render(<M2AeCompatibilitySummary
      resource={{
        id: 1, key: 'm2-ae-slot', label: 'M.2 Key E slot', count: 1,
        interfaceFamily: 'm2-ae', socketKeys: ['E'], moduleSizes: ['2230'],
      }}
      requirements={{ key: 'A+E', moduleSize: '2230', requiredBuses: [{ family: 'pcie' }] }}
    />)
    expect(screen.getByText(/Host bus evidence is not recorded/)).toBeInTheDocument()
  })
})
