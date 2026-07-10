import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { InventoryItemInput } from '@/lib/db'
import {
  getSwitchPortSpeedForType,
  isSupportedSwitchPortSpeed,
  isSwitchNetworkPortType,
  SWITCH_NETWORK_PORT_SPEEDS,
} from '@/lib/switch-ports'
import type {
  InventoryPort,
  InventoryPortRole,
  InventoryPortType,
  InventoryType,
} from '@/types/inventory'

const INVENTORY_TYPES: InventoryType[] = [
  'server',
  'nas',
  'cpu',
  'ram',
  'storage',
  'gpu',
  'network',
  'switch',
  'patchPanel',
]

const TYPE_LABELS: Record<InventoryType, string> = {
  server: 'Server',
  nas: 'NAS',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  gpu: 'GPU',
  network: 'Network Card',
  switch: 'Switch',
  patchPanel: 'Patch Panel',
}

const PORT_TYPES: InventoryPortType[] = [
  'rj45',
  'sfp',
  'sfp-plus',
  'hdmi',
  'displayport',
  'mini-displayport',
  'barrel',
]

const PORT_ROLES: InventoryPortRole[] = ['access', 'trunk', 'uplink', 'management', 'disabled']
const SPEEDS = ['', ...SWITCH_NETWORK_PORT_SPEEDS]
const RAM_SPEEDS = ['', '1600', '1866', '2133', '2400', '2666', '2933', '3200', '3600', '4800', '5600']
const STORAGE_FORM_FACTORS = ['', '2230', '2242', '2260', '2280', '2.5"', '3.5"', 'eMMC']
const SERVER_FORM_FACTORS = ['Tiny', 'Mini', 'Micro', 'Small', 'SFF', 'Tower', 'Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX']
const NETWORK_SLOTS = ['On board', 'PCIe', 'M.2 A+E']
const WIRELESS_OPTIONS = ['Yes', 'No']
const CPU_MANUFACTURERS = ['Intel', 'AMD', 'ARM']
const RAM_GENERATIONS = ['DDR3', 'DDR3L', 'DDR4', 'DDR5', 'LPDDR4', 'LPDDR5']
const STORAGE_INTERFACES = ['NVMe', 'SATA', 'SAS', 'eMMC', 'USB']
const GPU_MANUFACTURERS = ['AMD', 'Nvidia', 'Intel']
const GPU_FORM_FACTORS = ['Low profile', 'Full height', 'Half height', 'Single slot', 'Dual slot']
const GPU_SLOT_WIDTHS = ['Single slot', 'Dual slot', 'Triple slot']
const PCIE_OPTIONS = ['PCIe 2.0 x1', 'PCIe 2.0 x4', 'PCIe 2.0 x8', 'PCIe 3.0 x4', 'PCIe 3.0 x8', 'PCIe 3.0 x16', 'PCIe 4.0 x4', 'PCIe 4.0 x8', 'PCIe 4.0 x16', 'PCIe 5.0 x16']
const NETWORK_INTERFACES = ['PCIe 2.0 x1', 'PCIe 2.0 x4', 'PCIe 2.0 x8', 'PCIe 3.0 x1', 'PCIe 3.0 x4', 'PCIe 3.0 x8', 'M.2 A+E', 'USB']
const NETWORK_FORM_FACTORS = ['Low profile', 'Full height', 'M.2 2230 A+E', 'USB dongle', 'Onboard']

type PortGroup = {
  id: number
  count: number
  type: InventoryPortType
  speed: string
  role: InventoryPortRole
}

function defaultPortGroups(type: InventoryType): PortGroup[] {
  if (type === 'server') {
    return [
      { id: 1, count: 1, type: 'rj45', speed: '1G', role: 'access' },
      { id: 2, count: 2, type: 'displayport', speed: '', role: 'access' },
    ]
  }

  if (type === 'nas') {
    return [{ id: 1, count: 1, type: 'rj45', speed: '1G', role: 'access' }]
  }

  if (type === 'network') {
    return [{ id: 1, count: 1, type: 'rj45', speed: '1G', role: 'access' }]
  }

  if (type === 'gpu') {
    return [{ id: 1, count: 1, type: 'displayport', speed: '', role: 'access' }]
  }

  if (type === 'switch') {
    return [{ id: 1, count: 8, type: 'rj45', speed: '1G', role: 'access' }]
  }

  if (type === 'patchPanel') {
    return [{ id: 1, count: 24, type: 'rj45', speed: '', role: 'access' }]
  }

  return []
}

function fieldClassName() {
  return 'w-full border-[#ded8ce] bg-[#fffdf8] text-[#20242c] placeholder:text-[#8d857b]'
}

function formatPortTypeLabel(type: InventoryPortType): string {
  if (type === 'sfp-plus') {
    return 'SFP+'
  }

  if (type === 'displayport') {
    return 'DisplayPort'
  }

  if (type === 'mini-displayport') {
    return 'Mini DisplayPort'
  }

  return type.toUpperCase()
}

function Label({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <label className={`space-y-1 text-xs font-bold text-[#75695d] ${className}`}>{children}</label>
}

function SelectField({
  name,
  value,
  placeholder = 'Select',
  options,
  onValueChange,
  onOpenChange,
}: {
  name?: string
  value?: string
  placeholder?: string
  options: string[]
  onValueChange?: (value: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Select
      name={name}
      value={value}
      onValueChange={onValueChange}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger className={fieldClassName()}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function readString(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? '').trim()

  return value === '' || value === 'none' ? undefined : value
}

function readNumber(formData: FormData, key: string): number | undefined {
  const rawValue = String(formData.get(key) ?? '').trim()

  if (rawValue === '') {
    return undefined
  }

  const value = Number(rawValue)

  return Number.isFinite(value) ? value : undefined
}

function speedMbps(speed: string): number | undefined {
  if (speed === '1G') {
    return 1000
  }

  if (speed === '2.5G') {
    return 2500
  }

  if (speed === '5G') {
    return 5000
  }

  if (speed === '10G') {
    return 10000
  }

  return undefined
}

function buildPorts(type: InventoryType, groups: PortGroup[]): InventoryPort[] | undefined {
  let slotNumber = 1
  const ports: InventoryPort[] = []

  for (const group of groups) {
    const count = Math.max(0, Math.min(96, Number(group.count) || 0))

    for (let index = 0; index < count; index += 1) {
      const port: InventoryPort = {
        id: slotNumber,
        kind: type === 'switch' ? 'switch-port' : type === 'patchPanel' ? 'keystone' : 'server-port',
        type: group.type,
        slotNumber,
        label: '',
      }

      if (group.speed) {
        port.speed = group.speed
      }

      if (type === 'switch' || type === 'network') {
        port.role = group.role
      }

      if (type === 'patchPanel') {
        port.endpoints = [
          { id: 1, side: 'front' },
          { id: 2, side: 'back' },
        ]
      }

      ports.push(port)
      slotNumber += 1
    }
  }

  return ports.length > 0 ? ports : undefined
}

function buildItemInput(
  type: InventoryType,
  formData: FormData,
  portGroups: PortGroup[],
  storageUnit: 'GB' | 'TB',
): InventoryItemInput {
  const specs: Record<string, string | number | boolean | null> = {}
  const name = readString(formData, 'name') ?? ''
  const manufacturer = readString(formData, 'manufacturer')
  const model = readString(formData, 'model')
  const family = readString(formData, 'family')
  const number = readString(formData, 'number')
  const notes = readString(formData, 'notes')

  if (type === 'server') {
    specs.formFactor = readString(formData, 'formFactor') ?? 'Mini'
    const networkSlot = readString(formData, 'networkSlot')
    const wireless = readString(formData, 'wireless')

    if (networkSlot) specs.networkSlot = networkSlot
    if (wireless) specs.wireless = wireless
  }

  if (type === 'nas') {
    const driveBays = readNumber(formData, 'driveBays')
    const m2Slots = readNumber(formData, 'm2Slots')

    if (driveBays !== undefined) specs.driveBays = driveBays
    if (m2Slots !== undefined) specs.m2Slots = m2Slots
  }

  if (type === 'cpu') {
    for (const key of ['cores', 'threads', 'baseClockGhz', 'boostClockGhz']) {
      const value = readNumber(formData, key)
      if (value !== undefined) specs[key] = value
    }
  }

  if (type === 'ram') {
    const capacityGb = readNumber(formData, 'capacityGb')
    const generation = readString(formData, 'generation')
    const speedMt = readNumber(formData, 'speedMt')
    const secondarySpeedMt = readNumber(formData, 'secondarySpeedMt')

    if (capacityGb !== undefined) specs.capacityGb = capacityGb
    if (generation) specs.generation = generation
    if (speedMt !== undefined) specs.speedMt = speedMt
    if (secondarySpeedMt !== undefined) specs.secondarySpeedMt = secondarySpeedMt
  }

  if (type === 'storage') {
    const capacity = readNumber(formData, 'capacity')
    const storageInterface = readString(formData, 'interface')
    const formFactor = readString(formData, 'storageFormFactor')

    if (capacity !== undefined) specs[storageUnit === 'TB' ? 'capacityTb' : 'capacityGb'] = capacity
    if (storageInterface) specs.interface = storageInterface
    if (formFactor) specs.formFactor = formFactor
  }

  if (type === 'gpu') {
    const vramGb = readNumber(formData, 'vramGb')
    const formFactor = readString(formData, 'gpuFormFactor')
    const slotWidth = readString(formData, 'slotWidth')
    const pcie = readString(formData, 'pcie')

    if (vramGb !== undefined) specs.vramGb = vramGb
    if (formFactor) specs.formFactor = formFactor
    if (slotWidth) specs.slotWidth = slotWidth
    if (pcie) specs.pcie = pcie
  }

  if (type === 'network') {
    const interfaceName = readString(formData, 'interface')
    const formFactor = readString(formData, 'networkFormFactor')
    const firstSpeed = portGroups.map((group) => speedMbps(group.speed)).find((value) => value !== undefined)
    const totalPorts = portGroups.reduce((sum, group) => sum + Math.max(0, Number(group.count) || 0), 0)

    if (totalPorts > 0) specs.ports = totalPorts
    if (firstSpeed !== undefined) specs.speedMbps = firstSpeed
    if (interfaceName) specs.interface = interfaceName
    if (formFactor) specs.formFactor = formFactor
  }

  if (type === 'switch') {
    const management = readString(formData, 'management')
    const switchingCapacityGbps = readNumber(formData, 'switchingCapacityGbps')
    const fanless = formData.get('fanless') === 'on'

    if (management) specs.management = management
    if (switchingCapacityGbps !== undefined) specs.switchingCapacityGbps = switchingCapacityGbps
    specs.fanless = fanless
  }

  if (type === 'patchPanel') {
    const rackUnits = readNumber(formData, 'rackUnits')
    const mount = readString(formData, 'mount')

    if (rackUnits !== undefined) specs.rackUnits = rackUnits
    if (mount) specs.mount = mount
  }

  return {
    type,
    name,
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(family ? { family } : {}),
    ...(number ? { number } : {}),
    ...(Object.keys(specs).length > 0 ? { specs } : {}),
    ...(buildPorts(type, portGroups) ? { ports: buildPorts(type, portGroups) } : {}),
    ...(notes ? { notes } : {}),
  }
}

function PortGroupsEditor({
  type,
  groups,
  onChange,
  onSelectOpenChange,
}: {
  type: InventoryType
  groups: PortGroup[]
  onChange: (groups: PortGroup[]) => void
  onSelectOpenChange: (open: boolean) => void
}) {
  if (!['server', 'nas', 'gpu', 'network', 'switch', 'patchPanel'].includes(type)) {
    return null
  }

  function updateGroup(id: number, update: Partial<PortGroup>) {
    onChange(groups.map((group) => {
      if (group.id !== id) {
        return group
      }

      const nextGroup = { ...group, ...update }

      if (type === 'switch' && Object.prototype.hasOwnProperty.call(update, 'type')) {
        nextGroup.speed = getSwitchPortSpeedForType(nextGroup.type, nextGroup.speed) ?? ''
      }

      return nextGroup
    }))
  }

  return (
    <section className="rounded-md border border-[#ded8ce] bg-[#fffdf8] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-[#20242c]">Ports</h3>
          <p className="text-xs text-[#75695d]">
            Add one group per physical port type or speed.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...groups,
              {
                id: Date.now(),
                count: 1,
                type: type === 'gpu' ? 'displayport' : 'rj45',
                speed: type === 'gpu' || type === 'patchPanel' ? '' : '1G',
                role: 'access',
              },
            ])
          }
        >
          <Plus className="size-3" />
          Group
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {groups.map((group, index) => {
          const requiresSpeed = type === 'switch' && isSwitchNetworkPortType(group.type)
          const hasValidSpeed = isSupportedSwitchPortSpeed(group.speed)
          const speedOptions = requiresSpeed ? SWITCH_NETWORK_PORT_SPEEDS : SPEEDS

          return (
            <div key={group.id} className="grid grid-cols-2 gap-2 sm:grid-cols-[72px_1fr_1fr_1fr_auto]">
              <Input
                type="number"
                min={0}
                value={group.count}
                className={fieldClassName()}
                onChange={(event) => updateGroup(group.id, { count: Number(event.target.value) })}
                aria-label="Port count"
              />
              <Select
                value={group.type}
                onValueChange={(value) => updateGroup(group.id, { type: value as InventoryPortType })}
                onOpenChange={onSelectOpenChange}
              >
                <SelectTrigger className={fieldClassName()} aria-label={`Port group ${index + 1} type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORT_TYPES.map((portType) => (
                    <SelectItem key={portType} value={portType}>
                      {formatPortTypeLabel(portType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={requiresSpeed && !hasValidSpeed ? 'required' : group.speed || 'none'}
                onValueChange={(value) => updateGroup(group.id, { speed: value === 'none' ? '' : value })}
                onOpenChange={onSelectOpenChange}
              >
                <SelectTrigger className={fieldClassName()} aria-label={`Port group ${index + 1} speed`}>
                  <SelectValue placeholder="Select speed" />
                </SelectTrigger>
                <SelectContent>
                  {requiresSpeed && !hasValidSpeed ? (
                    <SelectItem value="required" disabled>Select speed</SelectItem>
                  ) : null}
                  {speedOptions.map((speed) => (
                    <SelectItem key={speed || 'none'} value={speed || 'none'}>
                      {speed || 'No speed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={group.role}
                onValueChange={(value) => updateGroup(group.id, { role: value as InventoryPortRole })}
                onOpenChange={onSelectOpenChange}
              >
                <SelectTrigger className={fieldClassName()}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORT_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(groups.filter((candidate) => candidate.id !== group.id))}
                aria-label="Remove port group"
              >
                <Trash2 className="size-4" />
              </Button>
              {requiresSpeed && !hasValidSpeed ? (
                <div role="alert" className="col-span-2 text-xs font-semibold text-[#8b3322] sm:col-span-5">
                  Select a supported speed for this {formatPortTypeLabel(group.type)} switch port group.
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function InventoryItemDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (item: InventoryItemInput) => Promise<void>
}) {
  const [type, setType] = useState<InventoryType>('server')
  const [portGroups, setPortGroups] = useState<PortGroup[]>(() => defaultPortGroups('server'))
  const [storageUnit, setStorageUnit] = useState<'GB' | 'TB'>('TB')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const selectMenuOpenRef = useRef(false)
  const lastSelectInteractionRef = useRef(0)
  const hasPorts = useMemo(() => defaultPortGroups(type).length > 0, [type])

  function resetDraft() {
    selectMenuOpenRef.current = false
    lastSelectInteractionRef.current = 0
    setType('server')
    setPortGroups(defaultPortGroups('server'))
    setStorageUnit('TB')
    setPending(false)
    setError(null)
    setDirty(false)
    setDiscardOpen(false)
    setFormKey((current) => current + 1)
  }

  function markDirty() {
    setDirty(true)
  }

  function requestClose() {
    if (pending) {
      return
    }

    if (selectMenuOpenRef.current || Date.now() - lastSelectInteractionRef.current < 200) {
      return
    }

    if (dirty) {
      setDiscardOpen(true)
      return
    }

    resetDraft()
    onOpenChange(false)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true)
      return
    }

    requestClose()
  }

  function discardChanges() {
    resetDraft()
    onOpenChange(false)
  }

  function changeType(nextType: InventoryType) {
    markDirty()
    setType(nextType)
    setPortGroups(defaultPortGroups(nextType))
    setError(null)
  }

  function changePortGroups(nextGroups: PortGroup[]) {
    markDirty()
    setPortGroups(nextGroups)
  }

  function handleSelectOpenChange(open: boolean) {
    selectMenuOpenRef.current = open
    lastSelectInteractionRef.current = Date.now()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const item = buildItemInput(type, formData, portGroups, storageUnit)

    if (!item.name.trim()) {
      setError('Name is required.')
      return
    }

    const invalidSwitchGroup = type === 'switch'
      ? portGroups.find(
          (group) => isSwitchNetworkPortType(group.type) && !isSupportedSwitchPortSpeed(group.speed),
        )
      : undefined

    if (invalidSwitchGroup) {
      setError(
        `Select a supported speed for the ${formatPortTypeLabel(invalidSwitchGroup.type)} switch port group.`,
      )
      return
    }

    setPending(true)
    setError(null)

    try {
      await onCreate(item)
      resetDraft()
      onOpenChange(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Item could not be created.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="!flex max-h-[calc(100dvh-2rem)] !flex-col gap-0 overflow-hidden bg-[#fffdf8] p-0 text-[#20242c] sm:max-w-2xl">
        <DialogHeader className="border-b border-[#ded8ce] px-4 py-4">
          <DialogTitle>Add inventory item</DialogTitle>
        </DialogHeader>
        <form
          key={formKey}
          onSubmit={handleSubmit}
          onChange={markDirty}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Label>
                <span>Type</span>
                <Select
                  value={type}
                  onValueChange={(value) => changeType(value as InventoryType)}
                  onOpenChange={handleSelectOpenChange}
                >
                  <SelectTrigger className={fieldClassName()} aria-label="Inventory type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_TYPES.map((inventoryType) => (
                      <SelectItem key={inventoryType} value={inventoryType}>
                        {TYPE_LABELS[inventoryType]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label>
                <span>Name</span>
                <Input name="name" required placeholder="Dell OptiPlex Micro 7090" className={fieldClassName()} />
              </Label>
              <Label>
                <span>Manufacturer</span>
                {type === 'cpu' ? (
                  <SelectField name="manufacturer" placeholder="Select manufacturer" options={CPU_MANUFACTURERS} onOpenChange={handleSelectOpenChange} onValueChange={markDirty} />
                ) : type === 'gpu' ? (
                  <SelectField name="manufacturer" placeholder="Select manufacturer" options={GPU_MANUFACTURERS} onOpenChange={handleSelectOpenChange} onValueChange={markDirty} />
                ) : (
                  <Input name="manufacturer" placeholder="Dell" className={fieldClassName()} />
                )}
              </Label>
              <Label>
                <span>Model</span>
                <Input name="model" placeholder="OptiPlex Micro 7090" className={fieldClassName()} />
              </Label>
            </div>

            {type === 'cpu' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Label>
                  <span>Family</span>
                  <Input name="family" placeholder="Core i5" className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Number</span>
                  <Input name="number" placeholder="i5-10500T" className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Cores</span>
                  <Input name="cores" type="number" min={1} className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Threads</span>
                  <Input name="threads" type="number" min={1} className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Base Clock</span>
                  <Input name="baseClockGhz" type="number" step="0.1" min={0} className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Boost Clock</span>
                  <Input name="boostClockGhz" type="number" step="0.1" min={0} className={fieldClassName()} />
                </Label>
              </div>
            ) : null}

            {type === 'ram' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Label>
                  <span>Capacity GB</span>
                  <Input name="capacityGb" type="number" min={1} className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Generation</span>
                  <SelectField
                    name="generation"
                    placeholder="Select generation"
                    options={RAM_GENERATIONS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>Stick 1 Speed</span>
                  <Select name="speedMt" onValueChange={markDirty} onOpenChange={handleSelectOpenChange}>
                    <SelectTrigger className={fieldClassName()}>
                      <SelectValue placeholder="Select speed" />
                    </SelectTrigger>
                    <SelectContent>
                      {RAM_SPEEDS.map((speed) => (
                        <SelectItem key={speed || 'none'} value={speed || 'none'}>
                          {speed ? `${speed}MHz` : 'Empty'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                <Label>
                  <span>Stick 2 Speed</span>
                  <Input name="secondarySpeedMt" type="number" min={0} placeholder="Same as stick 1" className={fieldClassName()} />
                </Label>
              </div>
            ) : null}

            {type === 'storage' ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Label className="sm:col-span-2">
                  <span>Capacity</span>
                  <Input name="capacity" type="number" min={0} step="0.1" className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Unit</span>
                  <Select
                    value={storageUnit}
                    onValueChange={(value) => {
                      markDirty()
                      setStorageUnit(value as 'GB' | 'TB')
                    }}
                  >
                    <SelectTrigger className={fieldClassName()}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TB">TB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
                <Label>
                  <span>Interface</span>
                  <SelectField
                    name="interface"
                    placeholder="Select interface"
                    options={STORAGE_INTERFACES}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>Form Factor</span>
                  <Select name="storageFormFactor" onValueChange={markDirty} onOpenChange={handleSelectOpenChange}>
                    <SelectTrigger className={fieldClassName()}>
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent>
                      {STORAGE_FORM_FACTORS.map((formFactor) => (
                        <SelectItem key={formFactor || 'none'} value={formFactor || 'none'}>
                          {formFactor || 'None'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
              </div>
            ) : null}

            {type === 'server' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Label>
                  <span>Form Factor</span>
                  <SelectField
                    name="formFactor"
                    placeholder="Select size"
                    options={SERVER_FORM_FACTORS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>Network Slot</span>
                  <SelectField
                    name="networkSlot"
                    placeholder="Select slot"
                    options={NETWORK_SLOTS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>Wireless</span>
                  <SelectField
                    name="wireless"
                    placeholder="Select"
                    options={WIRELESS_OPTIONS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
              </div>
            ) : null}

            {type === 'nas' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Label>
                  <span>Drive Bays</span>
                  <Input name="driveBays" type="number" min={0} className={fieldClassName()} />
                </Label>
                <Label>
                  <span>M.2 Slots</span>
                  <Input name="m2Slots" type="number" min={0} className={fieldClassName()} />
                </Label>
              </div>
            ) : null}

            {type === 'gpu' ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Label>
                  <span>VRAM GB</span>
                  <Input name="vramGb" type="number" min={0} className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Form Factor</span>
                  <SelectField
                    name="gpuFormFactor"
                    placeholder="Select form factor"
                    options={GPU_FORM_FACTORS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>Slot Width</span>
                  <SelectField
                    name="slotWidth"
                    placeholder="Select width"
                    options={GPU_SLOT_WIDTHS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>PCIe</span>
                  <SelectField
                    name="pcie"
                    placeholder="Select PCIe"
                    options={PCIE_OPTIONS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
              </div>
            ) : null}

            {type === 'network' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Label>
                  <span>Interface</span>
                  <SelectField
                    name="interface"
                    placeholder="Select interface"
                    options={NETWORK_INTERFACES}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
                <Label>
                  <span>Form Factor</span>
                  <SelectField
                    name="networkFormFactor"
                    placeholder="Select form factor"
                    options={NETWORK_FORM_FACTORS}
                    onOpenChange={handleSelectOpenChange}
                    onValueChange={markDirty}
                  />
                </Label>
              </div>
            ) : null}

            {type === 'switch' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Label>
                  <span>Management</span>
                  <Input name="management" placeholder="Omada managed" className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Switching Gbps</span>
                  <Input name="switchingCapacityGbps" type="number" min={0} className={fieldClassName()} />
                </Label>
                <label className="flex items-center gap-2 self-end px-1 py-2 text-sm font-bold text-[#20242c]">
                  <input name="fanless" type="checkbox" className="size-4" />
                  Fanless
                </label>
              </div>
            ) : null}

            {type === 'patchPanel' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Label>
                  <span>Rack Units</span>
                  <Input name="rackUnits" type="number" min={0} step="0.5" placeholder="1" className={fieldClassName()} />
                </Label>
                <Label>
                  <span>Mount</span>
                  <Input name="mount" placeholder="Rack mounted" className={fieldClassName()} />
                </Label>
              </div>
            ) : null}

            {hasPorts ? (
              <PortGroupsEditor
                type={type}
                groups={portGroups}
                onChange={changePortGroups}
                onSelectOpenChange={handleSelectOpenChange}
              />
            ) : null}

            <Label>
              <span>Notes</span>
              <textarea
                name="notes"
                className="min-h-20 w-full rounded-lg border border-[#ded8ce] bg-[#fffdf8] px-3 py-2 text-sm text-[#20242c] outline-none transition placeholder:text-[#8d857b] focus-visible:border-[#20242c] focus-visible:ring-2 focus-visible:ring-[#ddb668]/40"
                placeholder="Optional notes"
              />
            </Label>

            {error ? (
              <div className="rounded-md border border-[#dfb3a5] bg-[#fff4ef] px-3 py-2 text-sm text-[#8b3322]">
                {error}
              </div>
            ) : null}
          </div>
          <DialogFooter className="!mx-0 !mb-0 shrink-0 rounded-b-xl border-t border-[#ded8ce] bg-[#f5f0e8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="outline" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding...' : 'Add item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <DialogContent className="bg-[#fffdf8] text-[#20242c] sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-[#fff2c7] p-2 text-[#8b6514]">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-2">
              <DialogTitle>Discard changes?</DialogTitle>
              <DialogDescription>
                This item has unsaved changes. Closing the form will lose this draft.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="bg-[#f5f0e8]">
          <Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={discardChanges}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
