// Synthetic hardware only. Never import these fixtures into a live catalog.
export function laptopFixture() {
  return {
    type: 'laptop', name: 'Synthetic Notebook 13', manufacturer: 'Synthetic', model: 'Notebook 13',
    specs: { formFactor: 'Laptop' },
    fixedComponents: [{ id: 1, componentType: 'cpu', disposition: 'soldered', label: 'Processor', item: {
      type: 'cpu', name: 'Synthetic Mobile 13', manufacturer: 'Synthetic', model: 'Mobile 13', specs: { generation: 'Synthetic 1', tdpMw: 15000 },
    } }],
    compatibility: { host: {
      topologyCompleteness: 'complete',
      memory: { slots: 2, generations: ['DDR5'], formFactors: ['SO-DIMM'], maxCapacityMib: 65536, maxModuleCapacityMib: 32768, eccSupport: 'unsupported' },
      storageSlots: [{ id: 1, key: 'nvme', label: 'Drive', count: 1, interfaces: ['NVMe'], formFactors: ['2280'], location: 'internal', backplane: 'direct' }],
    } },
  }
}

export function laptopConformanceInputs(): Array<{ name: string, input: unknown }> {
  const cases: Array<{ name: string, input: unknown }> = []
  const add = (name: string, mutate: (item: any) => void = () => {}) => {
    const item = laptopFixture()
    mutate(item)
    cases.push({ name, input: item })
  }
  const fixedRam = { id: 2, componentType: 'ram', disposition: 'soldered', label: 'Memory', item: {
    type: 'ram', name: 'Synthetic fixed memory', specs: { capacityMib: 8192, generation: 'DDR5', formFactor: 'Onboard' },
  } }
  add('soldered-cpu-replaceable-memory')
  add('all-fixed-memory', (item) => {
    item.fixedComponents.push(structuredClone(fixedRam))
    item.compatibility.host.memory = { slots: 0, maxCapacityMib: 8192 }
  })
  add('mixed-memory', (item) => {
    item.fixedComponents.push(structuredClone(fixedRam))
    item.compatibility.host.memory = { slots: 1, maxCapacityMib: 40960, maxModuleCapacityMib: 32768 }
  })
  add('socketed-cpu', (item) => {
    delete item.fixedComponents
    item.compatibility.host.cpu = { sockets: ['Synthetic Socket'], socketCount: 1 }
  })
  for (const buses of [undefined, [], [{ family: 'pcie', lanes: 1, pcieGeneration: 3 }, { family: 'usb', usbGeneration: 'USB 2.0' }]]) {
    add(`physical-m2-${buses === undefined ? 'unknown' : buses.length ? 'populated' : 'empty'}`, (item) => {
      item.compatibility.host.optionalModuleSlots = [{ id: 1, key: 'physical-e', count: 1, interfaceFamily: 'm2-ae', socketKeys: ['E'], moduleSizes: ['2230'], intendedModuleKinds: ['wireless-card'], ...(buses === undefined ? {} : { availableBuses: buses }) }]
    })
  }
  for (const disposition of ['fixed', 'replaceable']) {
    add(`power-${disposition}`, (item) => {
      item.compatibility.host.power = { configuration: 'external-adapter', adapterDisposition: disposition, connector: 'Synthetic barrel', supportedPowerMw: [65000] }
    })
  }
  add('semantic-relationships', (item) => {
    const host = item.compatibility.host
    host.controllerSlots = [{ id: 7, key: 'nvme', count: 1, acceptedControllerKinds: ['storage-controller'] }]
    host.storageSlots[0].controllerSlotIds = [7]
    host.bootDeviceSlots = [{ id: 2, key: 'boot', count: 1, controllerSlotId: 7 }]
    host.constraintGroups = [{ id: 1, key: 'exclusive', kind: 'mutually-exclusive', members: [{ resourceType: 'storage-slot', resourceId: 1 }, { resourceType: 'boot-device-slot', resourceId: 2 }] }]
  })
  return cases
}
