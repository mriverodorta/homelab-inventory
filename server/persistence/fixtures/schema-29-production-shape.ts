const NOW = '2026-08-11T12:00:00.000Z'
const HASH_A = 'a'.repeat(64)

export function schema29ProductionShapeFixture() {
  return {
    meta: {
      schemaVersion: 29,
      appLastOpenedWith: '0.10.0',
      updatedAt: NOW,
    },
    inventory: {
      servers: [{
        id: 7,
        name: 'Example Micro Host',
        manufacturer: 'Example Systems',
        model: 'Micro 7000',
        hardwareClass: 'desktop',
        usageRole: 'server',
        specs: { formFactor: 'Micro', networkSlot: 'M.2 2230 A/E' },
        ports: [{ id: 1, kind: 'server-port', type: 'rj45', slotNumber: 1, speed: '1G', origin: 'fixed' }],
        compatibility: {
          host: {
            cpu: { sockets: ['LGA1200'], generations: ['10th Gen'], maxTdpWatts: 65, socketCount: 1 },
            memory: { slots: 2, generations: ['DDR4'], maxCapacityGb: 64, maxModuleCapacityGb: 32, maxSpeedMt: 2933 },
            storageSlots: [{ id: 1, key: 'm2-storage', label: 'M.2 storage', count: 1, interfaces: ['NVMe'], formFactors: ['2280'], pcieGeneration: 3 }],
            expansionSlots: [], optionalModuleSlots: [], controllerSlots: [], bootDeviceSlots: [],
          },
        },
      }],
      nas: [],
      pcBuilds: [],
      cpus: [{
        id: 3,
        name: 'Example CPU',
        manufacturer: 'Example Silicon',
        family: 'Core Family',
        number: 'CPU-100',
        specs: { cores: 6, threads: 12, baseClockGhz: 2.3, boostClockGhz: 3.8 },
        compatibility: { requirements: { cpu: { socket: 'LGA1200', generation: '10th Gen', tdpWatts: 35 } } },
      }],
      ram: [{ id: 9, name: '16GB DDR4', manufacturer: 'Example Memory', specs: { capacityGb: 16, generation: 'DDR4', speedMt: 3200, formFactor: 'SODIMM' } }],
      storage: [{ id: 4, name: '1TB NVMe', manufacturer: 'Example Storage', specs: { capacityTb: 1, interface: 'NVMe', formFactor: '2280', partitionTable: 'GPT' } }],
      gpus: [], networkCards: [], motherboards: [], cpuCoolers: [], cases: [], powerSupplies: [],
      soundCards: [], wirelessCards: [],
      powerAdapters: [{
        id: 2,
        name: 'Example 90W Adapter',
        manufacturer: 'Example Systems',
        specs: { wattageWatts: 90, connector: 'Slim tip' },
        ports: [{ id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1, label: 'AC input', origin: 'module' }],
      }],
      switches: [{
        id: 1,
        name: 'Example Switch',
        manufacturer: 'Example Networks',
        specs: { management: 'Managed', switchingCapacityGbps: 20, fanless: true },
        ports: [{ id: 1, kind: 'switch-port', type: 'rj45', slotNumber: 1, speed: '1G', role: 'access', origin: 'fixed' }],
      }],
      patchPanels: [{
        id: 1,
        name: 'Example Patch Panel',
        specs: { rackUnits: 1, mount: 'Rack mounted' },
        ports: [{
          id: 1, kind: 'keystone', type: 'rj45', slotNumber: 1, origin: 'fixed',
          endpoints: [{ id: 1, side: 'front' }, { id: 2, side: 'back' }],
        }],
      }],
      monitors: [], upsSystems: [],
      powerStrips: [{
        id: 1,
        name: 'Example Power Strip',
        specs: { outlets: 2, surgeProtected: true, surgeProtectedOutlets: 2 },
        ports: [
          { id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 0, origin: 'fixed' },
          { id: 2, key: 'outlet-1', kind: 'power-port', type: 'ac-outlet', slotNumber: 1, origin: 'fixed' },
          { id: 3, key: 'outlet-2', kind: 'power-port', type: 'ac-outlet', slotNumber: 2, origin: 'fixed' },
        ],
      }],
    },
    project: {
      id: 'default',
      revision: 8,
      metadata: { name: 'Default Project', version: 4, updatedAt: NOW },
      placements: [
        { itemType: 'server', itemId: 7, x: 120, y: 240 },
        { itemType: 'switch', itemId: 1, x: 600, y: 120 },
        { itemType: 'patchPanel', itemId: 1, x: 600, y: 360 },
        { itemType: 'powerStrip', itemId: 1, x: 120, y: 480 },
      ],
      assignments: [
        { id: 1, hostType: 'server', hostId: 7, itemType: 'cpu', itemId: 3, type: 'cpu', assignedAt: NOW, allocation: { resourceType: 'cpu', positions: [0] } },
        { id: 2, hostType: 'server', hostId: 7, itemType: 'ram', itemId: 9, type: 'ram', assignedAt: NOW, allocation: { resourceType: 'memory', positions: [0] } },
        { id: 3, hostType: 'server', hostId: 7, itemType: 'storage', itemId: 4, type: 'storage', assignedAt: NOW, allocation: { resourceType: 'storage', groupId: 1, positions: [0] } },
        { id: 4, hostType: 'server', hostId: 7, itemType: 'powerAdapter', itemId: 2, type: 'powerAdapter', assignedAt: NOW },
      ],
      connections: [
        {
          id: 1,
          from: { itemType: 'switch', itemId: 1, portId: 1 },
          to: { itemType: 'patchPanel', itemId: 1, portId: 1, endpointId: 2 },
          type: 'network',
          negotiatedSpeedMbps: 1000,
          createdAt: NOW,
          route: { sourceSide: 'bottom', targetSide: 'top', bendPoints: [{ x: 660, y: 300 }], avoidCableOverlap: true },
        },
        {
          id: 2,
          from: { itemType: 'powerStrip', itemId: 1, portId: 2 },
          to: { itemType: 'server', itemId: 7, hostedItemType: 'powerAdapter', hostedItemId: 2, portId: 1 },
          type: 'power',
          createdAt: NOW,
          route: { sourceSide: 'top', targetSide: 'bottom' },
        },
      ],
      compatibilityPolicy: {
        disabledHosts: [{ hostType: 'server', hostId: 7 }],
        ignoredWarningIds: ['compatibility:server:7:cpu'],
      },
    },
    registry: {
      settings: { mode: 'connected', defaultInventorySource: 'catalog', automaticContributions: false, showRegistryLinkIndicators: true, updatedAt: NOW },
      sources: [{ id: 1, kind: 'official-connected', displayName: 'Official Registry', endpoint: 'https://registry.example.test', trustedKeyId: 'test-key', enabled: true, lastCheckedAt: NOW, lastSuccessAt: NOW }],
      links: [{ id: 1, itemType: 'cpu', itemId: 3, sourceId: 1, templateKey: 'cpu-example-cpu-100', importedRevision: 1, importedContentHash: HASH_A, importedFingerprintVersion: 2, state: 'linked', linkedAt: NOW, updatedAt: NOW }],
      variantMatches: [], contributionOutbox: [], contributionLedger: [], contributionGroups: [], projectionCache: [], privateTemplates: [], snapshot: null, installationIdentity: null,
    },
    routingCache: {
      version: 1,
      plannerVersion: 'fixture-planner',
      geometryFingerprint: 'geometry-1',
      obstacles: [], failures: [], updatedAt: NOW,
      entries: [{
        input: { request: { definition: { connection_id: 1 } } },
        result: { route: { connection_id: 1, points: [{ x: 600, y: 200 }, { x: 600, y: 300 }, { x: 660, y: 300 }], manual_anchor_point_indexes: [1] }, source_side: 'bottom', target_side: 'top', used_fallback: false, warning: null },
      }],
    },
    agents: {
      enrollments: {},
      devices: { 4: { id: 4, hostType: 'server', hostId: 7, publicKey: 'fixture-agent-key', protocolMajor: 1, version: '0.1.8', capabilities: { hardware: true }, lastSequence: 4, lastSeenAt: NOW, createdAt: NOW } },
      hardwareSnapshots: {}, hardwareEvents: {},
    },
    agentStatus: { hosts: {} },
    authentication: {
      settings: { enabled: false, localEnabled: false, oidcEnabled: false, setupRequired: false, updatedAt: NOW },
      accounts: [{ id: 1, username: 'owner', displayName: 'Owner', protectedOwner: true, active: true, createdAt: NOW, updatedAt: NOW }],
      roles: [], permissions: [], rolePermissions: [], accountRoles: [], sessions: [], credentials: [], identities: [], invitations: [],
    },
    notifications: {
      revision: 2, enabled: true, incidentRetentionDays: 90, deliveryAttemptRetentionDays: 30,
      contactPoints: [{ id: 1, type: 'ntfy', name: 'Primary', enabled: true, secretId: null, config: { topic: 'fixture' }, createdAt: NOW, updatedAt: NOW }],
      rules: [], quietHours: [], hostOverrides: [], monitoredResources: [], updatedAt: NOW,
    },
    notificationState: {
      incidents: [{ id: 1, hostType: 'server', hostId: 7, eventKey: 'server:7:host.offline', eventType: 'host.offline', severity: 'critical', title: 'Offline', summary: 'No heartbeat', state: 'resolved', openedAt: NOW, resolvedAt: NOW, createdAt: NOW, updatedAt: NOW }],
      transitions: [], acknowledgements: [], deliveryJobs: [{ id: 1, incidentId: 1, contactPointId: 1, kind: 'opening', state: 'delivered', idempotencyKey: 'fixture-delivery', attemptCount: 1, availableAt: NOW, deliveredAt: NOW, createdAt: NOW, updatedAt: NOW }],
      deliveryAttempts: [], cooldowns: [], normalizedStates: [], pendingTransitions: [], evaluationCursors: [],
    },
    notificationSecrets: { secrets: [] },
    backupManagement: {
      schedule: { enabled: true, frequency: 'daily', localTime: '03:30', weekday: 0, retentionCount: 14, updatedAt: NOW },
      backups: [{ id: 1, kind: 'manual', label: 'Fixture', state: 'verified', formatVersion: 1, selectedSections: ['inventory', 'project'], path: '/fixture/backup', sizeBytes: 1024, digest: HASH_A, startedAt: NOW, completedAt: NOW }],
      restores: [], operation: null,
    },
  }
}
