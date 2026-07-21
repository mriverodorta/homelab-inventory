import { describe, expect, it } from 'vitest'
import {
  classifyConnectionEndpoints,
  createPowerConnection,
  getPowerEndpoints,
  getPowerTopologyFindings,
  monitorPowerInputEndpoint,
  powerOutletEndpoint,
  powerStripPowerInputEndpoint,
  removePowerConnection,
  resolvePowerEndpoint,
  validatePowerConnection,
} from '@/lib/power-topology'
import type {
  ConnectionEndpoint,
  InventoryConnection,
  InventoryItem,
  ProjectState,
} from '@/types/inventory'

const CREATED_AT = '2026-07-20T12:00:00.000Z'

function item(
  id: number,
  type: InventoryItem['type'],
  name: string,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return { id, type, name, ...overrides }
}

function project(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Power lab', version: 1, updatedAt: CREATED_AT },
    items: {
      'ups:1': item(1, 'ups', 'Rack UPS', {
        specs: {
          outlets: 2,
          batteryBackupOutlets: 1,
          surgeProtectedOutlets: 1,
        },
      }),
      'powerStrip:1': item(1, 'powerStrip', 'Bench strip', {
        specs: { outlets: 2 },
      }),
      'monitor:1': item(1, 'monitor', 'Main display'),
      'monitor:2': item(2, 'monitor', 'Side display'),
      'pcBuild:1': item(1, 'pcBuild', 'Gaming PC'),
      'server:1': item(1, 'server', 'Mini server'),
      'nas:1': item(1, 'nas', 'Storage NAS'),
      'powerSupply:1': item(1, 'powerSupply', '750W PSU'),
      'powerAdapter:1': item(1, 'powerAdapter', '90W adapter'),
      'switch:1': item(1, 'switch', 'Network switch', {
        ports: [
          { id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1 },
          { id: 2, kind: 'switch-port', type: 'hdmi', slotNumber: 2 },
        ],
      }),
    },
    placements: [],
    assignments: [
      {
        id: 1,
        serverId: 'pcBuild:1',
        itemId: 'powerSupply:1',
        type: 'powerSupply',
        assignedAt: CREATED_AT,
      },
      {
        id: 2,
        serverId: 'server:1',
        itemId: 'powerAdapter:1',
        type: 'powerAdapter',
        assignedAt: CREATED_AT,
      },
    ],
    connections: [],
    ...overrides,
  }
}

function pcInput(): ConnectionEndpoint {
  return {
    itemId: 'pcBuild:1',
    hostedItemId: 'powerSupply:1',
    portId: 'ac-input',
  }
}

function serverInput(): ConnectionEndpoint {
  return {
    itemId: 'server:1',
    hostedItemId: 'powerAdapter:1',
    portId: 'ac-input',
  }
}

function powerConnection(
  id: number,
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  overrides: Partial<InventoryConnection> = {},
): InventoryConnection {
  return {
    id,
    from,
    to,
    type: 'power',
    createdAt: CREATED_AT,
    ...overrides,
  }
}

describe('power endpoint modeling', () => {
  it('derives stable UPS, power strip, monitor, PSU, and OEM adapter endpoints', () => {
    const endpoints = getPowerEndpoints(project())

    expect(endpoints.map(({ endpoint, direction, kind }) => ({ endpoint, direction, kind })))
      .toEqual(expect.arrayContaining([
        {
          endpoint: powerOutletEndpoint('ups:1', 1),
          direction: 'output',
          kind: 'ups-outlet',
        },
        {
          endpoint: powerOutletEndpoint('ups:1', 2),
          direction: 'output',
          kind: 'ups-outlet',
        },
        {
          endpoint: powerOutletEndpoint('powerStrip:1', 1),
          direction: 'output',
          kind: 'power-strip-outlet',
        },
        {
          endpoint: powerStripPowerInputEndpoint('powerStrip:1'),
          direction: 'input',
          kind: 'power-strip-input',
        },
        {
          endpoint: monitorPowerInputEndpoint('monitor:1'),
          direction: 'input',
          kind: 'monitor-input',
        },
        {
          endpoint: pcInput(),
          direction: 'input',
          kind: 'pc-power-supply-input',
        },
        {
          endpoint: serverInput(),
          direction: 'input',
          kind: 'oem-power-adapter-input',
        },
      ]))
    expect(resolvePowerEndpoint(project(), powerOutletEndpoint('ups:1', 3))).toBeNull()
  })

  it('does not expose unassigned, archived, or mismatched host power components', () => {
    const state = project({
      assignments: [],
      items: {
        ...project().items,
        'monitor:1': {
          ...project().items['monitor:1'],
          archivedAt: CREATED_AT,
        },
      },
    })

    expect(resolvePowerEndpoint(state, pcInput())).toBeNull()
    expect(resolvePowerEndpoint(state, serverInput())).toBeNull()
    expect(resolvePowerEndpoint(state, monitorPowerInputEndpoint('monitor:1'))).toBeNull()
  })

  it('uses the explicit outlet fan-out flag and otherwise defaults to one load per outlet', () => {
    const normal = resolvePowerEndpoint(project(), powerOutletEndpoint('powerStrip:1', 1))
    const fanOutProject = project({
      items: {
        ...project().items,
        'powerStrip:1': {
          ...project().items['powerStrip:1'],
          specs: { outlets: 2, allowOutletFanOut: true },
        },
      },
    })
    const modeled = resolvePowerEndpoint(fanOutProject, powerOutletEndpoint('powerStrip:1', 1))

    expect(normal?.allowFanOut).toBe(false)
    expect(modeled?.allowFanOut).toBe(true)
  })
})

describe('power connection validation and lifecycle', () => {
  it('classifies power separately from network, display, and unresolved endpoints', () => {
    const state = project()

    expect(classifyConnectionEndpoints(
      state,
      powerOutletEndpoint('ups:1', 1),
      monitorPowerInputEndpoint('monitor:1'),
    )).toBe('power')
    expect(classifyConnectionEndpoints(
      state,
      { itemId: 'switch:1', portId: 1 },
      { itemId: 'switch:1', portId: 1 },
    )).toBe('network')
    expect(classifyConnectionEndpoints(
      state,
      { itemId: 'switch:1', portId: 2 },
      { itemId: 'switch:1', portId: 2 },
    )).toBe('display')
    expect(classifyConnectionEndpoints(
      state,
      powerOutletEndpoint('ups:1', 1),
      { itemId: 'switch:1', portId: 1 },
    )).toBe('other')
  })

  it('requires outlet-to-input direction and rejects missing or self endpoints', () => {
    const state = project()
    const outlet = powerOutletEndpoint('ups:1', 1)
    const input = monitorPowerInputEndpoint('monitor:1')

    expect(validatePowerConnection(state, outlet, input)).toEqual({ ok: true })
    expect(validatePowerConnection(state, input, outlet)).toMatchObject({
      ok: false,
      message: expect.stringContaining('outlet to an AC input'),
    })
    expect(validatePowerConnection(state, powerOutletEndpoint('ups:1', 9), input)).toMatchObject({
      ok: false,
      message: expect.stringContaining('no longer available'),
    })
    expect(validatePowerConnection(
      state,
      powerOutletEndpoint('powerStrip:1', 1),
      { itemId: 'powerStrip:1', portId: 'ac-input' },
    )).toMatchObject({ ok: false })
  })

  it('connects a UPS outlet to a power strip input and reserves that input', () => {
    const state = project()
    const stripInput = powerStripPowerInputEndpoint('powerStrip:1')
    const first = createPowerConnection(
      state,
      powerOutletEndpoint('ups:1', 1),
      stripInput,
    )

    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(first.connection).toMatchObject({
      type: 'power',
      from: powerOutletEndpoint('ups:1', 1),
      to: stripInput,
    })
    expect(validatePowerConnection(
      first.project,
      powerOutletEndpoint('ups:1', 2),
      stripInput,
    )).toMatchObject({ ok: false, message: expect.stringContaining('input already') })
  })

  it('creates an additive power connection without mutating the input project', () => {
    const state = project()
    const result = createPowerConnection(
      state,
      powerOutletEndpoint('ups:1', 1),
      pcInput(),
    )

    expect(result.ok).toBe(true)
    expect(state.connections).toEqual([])
    if (!result.ok) {
      return
    }
    expect(result.connection).toMatchObject({
      id: 1,
      type: 'power',
      from: powerOutletEndpoint('ups:1', 1),
      to: pcInput(),
    })
    expect(result.project.connections).toEqual([result.connection])
    expect(result.project.metadata.updatedAt).not.toBe(CREATED_AT)
  })

  it('allows only one connection per input and one per ordinary outlet', () => {
    const first = powerConnection(
      1,
      powerOutletEndpoint('ups:1', 1),
      monitorPowerInputEndpoint('monitor:1'),
    )
    const state = project({ connections: [first] })

    expect(validatePowerConnection(
      state,
      powerOutletEndpoint('ups:1', 2),
      monitorPowerInputEndpoint('monitor:1'),
    )).toMatchObject({ ok: false, message: expect.stringContaining('input already') })
    expect(validatePowerConnection(
      state,
      powerOutletEndpoint('ups:1', 1),
      monitorPowerInputEndpoint('monitor:2'),
    )).toMatchObject({ ok: false, message: expect.stringContaining('outlet already') })
  })

  it('permits explicitly modeled output fan-out while retaining single-connection inputs', () => {
    const state = project({
      items: {
        ...project().items,
        'powerStrip:1': {
          ...project().items['powerStrip:1'],
          specs: { outlets: 2, allowOutletFanOut: true },
        },
      },
      connections: [powerConnection(
        1,
        powerOutletEndpoint('powerStrip:1', 1),
        monitorPowerInputEndpoint('monitor:1'),
      )],
    })

    expect(validatePowerConnection(
      state,
      powerOutletEndpoint('powerStrip:1', 1),
      monitorPowerInputEndpoint('monitor:2'),
    )).toEqual({ ok: true })
  })

  it('removes only power connections and preserves unrelated existing connections', () => {
    const network: InventoryConnection = {
      id: 1,
      from: { itemId: 'switch:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
      type: 'network',
      createdAt: CREATED_AT,
    }
    const power = powerConnection(
      2,
      powerOutletEndpoint('ups:1', 1),
      monitorPowerInputEndpoint('monitor:1'),
    )
    const state = project({ connections: [network, power] })

    expect(removePowerConnection(state, network.id)).toMatchObject({ ok: false })
    const result = removePowerConnection(state, power.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.connections).toEqual([network])
    }
  })
})

describe('power topology audit', () => {
  it('reports only placed unpowered hosts and monitors', () => {
    const state = project({
      placements: [
        { serverId: 'pcBuild:1', x: 0, y: 0 },
        { serverId: 'server:1', x: 100, y: 0 },
        { serverId: 'monitor:1', x: 200, y: 0 },
      ],
      connections: [powerConnection(
        1,
        powerOutletEndpoint('ups:1', 1),
        pcInput(),
      )],
    })

    const findings = getPowerTopologyFindings(state)
    expect(findings.map((finding) => [finding.code, finding.itemId])).toEqual([
      ['power.host.unpowered', 'server:1'],
      ['power.monitor.unpowered', 'monitor:1'],
    ])
    expect(findings.some((finding) => finding.itemId === 'monitor:2')).toBe(false)
    expect(findings.some((finding) => finding.itemId === 'nas:1')).toBe(false)
  })

  it('reports placed hosts that do not have the required assigned power component', () => {
    const state = project({
      placements: [
        { serverId: 'pcBuild:1', x: 0, y: 0 },
        { serverId: 'nas:1', x: 100, y: 0 },
      ],
      assignments: [],
    })

    expect(getPowerTopologyFindings(state).map((finding) => finding.code)).toEqual([
      'power.host.missing-input',
      'power.host.missing-input',
    ])
  })

  it('detects stale endpoints, invalid direction, duplicate inputs, and unmodeled fan-out', () => {
    const outlet = powerOutletEndpoint('ups:1', 1)
    const firstInput = monitorPowerInputEndpoint('monitor:1')
    const secondInput = monitorPowerInputEndpoint('monitor:2')
    const state = project({
      connections: [
        powerConnection(1, outlet, firstInput),
        powerConnection(2, outlet, secondInput),
        powerConnection(3, powerOutletEndpoint('ups:1', 2), firstInput),
        powerConnection(4, firstInput, powerOutletEndpoint('powerStrip:1', 1)),
        powerConnection(5, powerOutletEndpoint('ups:1', 99), secondInput),
      ],
    })

    const codes = getPowerTopologyFindings(state).map((finding) => finding.code)
    expect(codes).toContain('power.connection.output-fan-out')
    expect(codes).toContain('power.connection.duplicate-input')
    expect(codes).toContain('power.connection.invalid-direction')
    expect(codes).toContain('power.connection.stale-endpoint')
  })

  it('flags a power endpoint stored under a legacy non-power classification without rewriting it', () => {
    const legacy: InventoryConnection = {
      ...powerConnection(
        1,
        powerOutletEndpoint('ups:1', 1),
        monitorPowerInputEndpoint('monitor:1'),
      ),
      type: 'other',
    }
    const state = project({ connections: [legacy] })

    expect(getPowerTopologyFindings(state)).toEqual([
      expect.objectContaining({
        code: 'power.connection.misclassified',
        connectionId: 1,
      }),
    ])
    expect(state.connections).toEqual([legacy])
  })
})
