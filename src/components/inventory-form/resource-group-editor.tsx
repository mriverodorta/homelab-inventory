import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldError, SelectField, TextField } from './field-primitives'
import { ExpansionInterfaceFields } from './expansion-interface-fields'
import type {
  ExpansionSlotGroupDraft,
  MotherboardPowerConnectorDraft,
  OptionalModuleSlotGroupDraft,
  StorageSlotGroupDraft,
} from './model'
import {
  getExpansionSlotGroupValidationTarget,
  getMotherboardPowerConnectorValidationTarget,
  getOptionalModuleSlotGroupValidationTarget,
  getStorageSlotGroupValidationTarget,
} from './model'
import {
  CARD_HEIGHTS,
  EXPANSION_INTERFACE_FAMILIES,
  PCIE_GENERATIONS,
  PCIE_LANE_WIDTHS,
  OPTIONAL_MODULE_KINDS,
  SLOT_WIDTHS,
  STORAGE_FORM_FACTORS,
  STORAGE_INTERFACES,
} from './options'

let resourceGroupSequence = 0

function createResourceGroupDraftKey(kind: 'storage' | 'expansion' | 'optional-module' | 'power-connector'): string {
  resourceGroupSequence += 1
  return `${kind}-${Date.now().toString(36)}-${resourceGroupSequence.toString(36)}`
}

function CheckboxOptions({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-bold text-[#75695d]">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.filter(Boolean).map((option) => (
          <label key={option} className="flex min-h-9 items-center gap-2 rounded-md border border-[#ded8ce] bg-[#fffdf8] px-3 text-xs font-semibold text-[#3d3832]">
            <Input
              aria-label={`${label}: ${option}`}
              type="checkbox"
              checked={selected.includes(option)}
              className="size-4 rounded-none"
              onChange={(event) => onChange(
                event.target.checked
                  ? [...selected, option]
                  : selected.filter((value) => value !== option),
              )}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function StorageSlotGroupsEditor({
  groups,
  error,
  onChange,
  onSelectOpenChange,
}: {
  groups: StorageSlotGroupDraft[]
  error?: string
  onChange: (groups: StorageSlotGroupDraft[]) => void
  onSelectOpenChange?: (open: boolean) => void
}) {
  const validationTarget = error ? getStorageSlotGroupValidationTarget(groups) : null
  const updateGroup = (draftKey: string, patch: Partial<StorageSlotGroupDraft>) => {
    onChange(groups.map((group) => group.draftKey === draftKey ? { ...group, ...patch } : group))
  }

  return (
    <section aria-labelledby="storage-slot-groups-heading" className="space-y-3 rounded-md border border-[#e4d9c9] bg-[#fbf8f2] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id="storage-slot-groups-heading" className="text-sm font-bold text-[#20242c]">Storage slot groups</h4>
          <p className="text-xs text-[#75695d]">Describe the internal drive connectors this host accepts.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Add storage slot group"
          onClick={() => onChange([...groups, {
            draftKey: createResourceGroupDraftKey('storage'),
            key: '',
            label: '',
            count: '',
            interfaces: [],
            formFactors: [],
            pcieGeneration: '',
            location: '',
            hotSwap: false,
            backplane: '',
            controllerSlotIds: '',
            directConnect: false,
          }])}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add group
        </Button>
      </div>
      {groups.map((group, index) => (
        <div key={group.draftKey} className="space-y-3 rounded-md border border-[#ded8ce] bg-white p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <TextField label={`Storage group ${index + 1} label`} name={`storage-group-${group.draftKey}-label`} value={group.label} placeholder="Primary M.2" onChange={(label) => updateGroup(group.draftKey, { label })} />
            <TextField
              label="Count"
              ariaLabel={`Storage group ${index + 1} count`}
              name={`storage-group-${group.draftKey}-count`}
              value={group.count}
              type="number"
              min={1}
              placeholder="1"
              error={validationTarget?.index === index ? error : undefined}
              onChange={(count) => updateGroup(group.draftKey, { count })}
            />
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove storage group ${index + 1}`} onClick={() => onChange(groups.filter((entry) => entry.draftKey !== group.draftKey))}>
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <CheckboxOptions label={`Storage group ${index + 1} interfaces`} options={STORAGE_INTERFACES} selected={group.interfaces} onChange={(interfaces) => updateGroup(group.draftKey, { interfaces })} />
          <CheckboxOptions label={`Storage group ${index + 1} form factors`} options={STORAGE_FORM_FACTORS} selected={group.formFactors} onChange={(formFactors) => updateGroup(group.draftKey, { formFactors })} />
          <SelectField label="PCIe generation" name={`storage-group-${group.draftKey}-pcie-generation`} value={group.pcieGeneration} options={PCIE_GENERATIONS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(pcieGeneration) => updateGroup(group.draftKey, { pcieGeneration })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Location" name={`storage-group-${group.draftKey}-location`} value={group.location} placeholder="external" onChange={(location) => updateGroup(group.draftKey, { location })} />
            <TextField label="Backplane" name={`storage-group-${group.draftKey}-backplane`} value={group.backplane} placeholder="10-bay SFF backplane" onChange={(backplane) => updateGroup(group.draftKey, { backplane })} />
            <TextField label="Controller slot IDs" name={`storage-group-${group.draftKey}-controllers`} value={group.controllerSlotIds} placeholder="1, 2" onChange={(controllerSlotIds) => updateGroup(group.draftKey, { controllerSlotIds })} />
          </div>
          <div className="flex flex-wrap gap-4 text-xs font-semibold text-[#3d3832]">
            <label className="flex items-center gap-2"><Input type="checkbox" className="size-4 rounded-none" checked={group.hotSwap} onChange={(event) => updateGroup(group.draftKey, { hotSwap: event.target.checked })} />Hot-swap</label>
            <label className="flex items-center gap-2"><Input type="checkbox" className="size-4 rounded-none" checked={group.directConnect} onChange={(event) => updateGroup(group.draftKey, { directConnect: event.target.checked })} />Direct-connect topology</label>
          </div>
        </div>
      ))}
      {!validationTarget ? <FieldError message={error} /> : null}
    </section>
  )
}

export function ExpansionSlotGroupsEditor({
  groups,
  error,
  onChange,
  onSelectOpenChange,
}: {
  groups: ExpansionSlotGroupDraft[]
  error?: string
  onChange: (groups: ExpansionSlotGroupDraft[]) => void
  onSelectOpenChange?: (open: boolean) => void
}) {
  const validationTarget = error ? getExpansionSlotGroupValidationTarget(groups) : null
  const updateGroup = (draftKey: string, patch: Partial<ExpansionSlotGroupDraft>) => {
    onChange(groups.map((group) => group.draftKey === draftKey ? { ...group, ...patch } : group))
  }

  return (
    <section aria-labelledby="expansion-slot-groups-heading" className="space-y-3 rounded-md border border-[#e4d9c9] bg-[#fbf8f2] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id="expansion-slot-groups-heading" className="text-sm font-bold text-[#20242c]">Expansion slot groups</h4>
          <p className="text-xs text-[#75695d]">Describe card slots, lane limits, and physical constraints.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Add expansion slot group"
          onClick={() => onChange([...groups, {
            draftKey: createResourceGroupDraftKey('expansion'),
            key: '',
            label: '',
            count: '',
            interfaceFamily: '',
            interfaceKey: '',
            keying: '',
            moduleSize: '',
            usbGeneration: '',
            connector: '',
            ocpVersion: '',
            pcieGeneration: '',
            mechanicalLanes: '',
            electricalLanes: '',
            acceptedHeights: [],
            maxSlotWidth: '',
            maxPowerWatts: '',
            proprietaryRiser: false,
            riserCapability: '',
            requiredCpuSockets: '',
            riserGroup: '',
          }])}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add group
        </Button>
      </div>
      {groups.map((group, index) => (
        <div key={group.draftKey} className="space-y-3 rounded-md border border-[#ded8ce] bg-white p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <TextField label={`Expansion group ${index + 1} label`} name={`expansion-group-${group.draftKey}-label`} value={group.label} placeholder="PCIe slot" onChange={(label) => updateGroup(group.draftKey, { label })} />
            <TextField
              label="Count"
              ariaLabel={`Expansion group ${index + 1} count`}
              name={`expansion-group-${group.draftKey}-count`}
              value={group.count}
              type="number"
              min={1}
              placeholder="1"
              error={validationTarget?.index === index ? error : undefined}
              onChange={(count) => updateGroup(group.draftKey, { count })}
            />
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove expansion group ${index + 1}`} onClick={() => onChange(groups.filter((entry) => entry.draftKey !== group.draftKey))}>
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Interface family" name={`expansion-group-${group.draftKey}-interface`} value={group.interfaceFamily} options={EXPANSION_INTERFACE_FAMILIES} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(interfaceFamily) => updateGroup(group.draftKey, { interfaceFamily })} />
            <SelectField label="PCIe generation" name={`expansion-group-${group.draftKey}-pcie-generation`} value={group.pcieGeneration} options={PCIE_GENERATIONS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(pcieGeneration) => updateGroup(group.draftKey, { pcieGeneration })} />
            <SelectField label="Mechanical lanes" name={`expansion-group-${group.draftKey}-mechanical-lanes`} value={group.mechanicalLanes} options={PCIE_LANE_WIDTHS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(mechanicalLanes) => updateGroup(group.draftKey, { mechanicalLanes })} />
            <SelectField label="Electrical lanes" name={`expansion-group-${group.draftKey}-electrical-lanes`} value={group.electricalLanes} options={PCIE_LANE_WIDTHS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(electricalLanes) => updateGroup(group.draftKey, { electricalLanes })} />
            <SelectField label="Maximum slot width" name={`expansion-group-${group.draftKey}-slot-width`} value={group.maxSlotWidth} options={SLOT_WIDTHS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(maxSlotWidth) => updateGroup(group.draftKey, { maxSlotWidth })} />
            <TextField label="Maximum power (W)" name={`expansion-group-${group.draftKey}-power`} value={group.maxPowerWatts} type="number" min={0} placeholder="75" onChange={(maxPowerWatts) => updateGroup(group.draftKey, { maxPowerWatts })} />
          </div>
          <ExpansionInterfaceFields group={group} onChange={(patch) => updateGroup(group.draftKey, patch)} />
          <CheckboxOptions label={`Expansion group ${index + 1} accepted heights`} options={CARD_HEIGHTS} selected={group.acceptedHeights} onChange={(acceptedHeights) => updateGroup(group.draftKey, { acceptedHeights })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-[#ded8ce] bg-[#fffdf8] px-3 text-xs font-semibold text-[#3d3832]">
              <Input
                aria-label={`Expansion group ${index + 1} requires proprietary riser`}
                type="checkbox"
                checked={group.proprietaryRiser === true}
                className="size-4 rounded-none"
                onChange={(event) => updateGroup(group.draftKey, { proprietaryRiser: event.target.checked })}
              />
              Proprietary riser
            </label>
            <TextField label="Riser capability" name={`expansion-group-${group.draftKey}-riser-capability`} value={group.riserCapability} placeholder="Dell proprietary PCIe riser" onChange={(riserCapability) => updateGroup(group.draftKey, { riserCapability })} />
            <TextField label="Riser group" name={`expansion-group-${group.draftKey}-riser-group`} value={group.riserGroup} placeholder="riser-2" onChange={(riserGroup) => updateGroup(group.draftKey, { riserGroup })} />
            <TextField label="Required populated CPUs" name={`expansion-group-${group.draftKey}-required-cpus`} value={group.requiredCpuSockets} type="number" min={1} placeholder="2" onChange={(requiredCpuSockets) => updateGroup(group.draftKey, { requiredCpuSockets })} />
          </div>
        </div>
      ))}
      {!validationTarget ? <FieldError message={error} /> : null}
    </section>
  )
}

export function OptionalModuleSlotGroupsEditor({
  groups,
  error,
  onChange,
}: {
  groups: OptionalModuleSlotGroupDraft[]
  error?: string
  onChange: (groups: OptionalModuleSlotGroupDraft[]) => void
}) {
  const validationTarget = error ? getOptionalModuleSlotGroupValidationTarget(groups) : null
  const updateGroup = (draftKey: string, patch: Partial<OptionalModuleSlotGroupDraft>) => {
    onChange(groups.map((group) => group.draftKey === draftKey ? { ...group, ...patch } : group))
  }

  return (
    <section aria-labelledby="optional-module-slot-groups-heading" className="space-y-3 rounded-md border border-[#e4d9c9] bg-[#fbf8f2] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id="optional-module-slot-groups-heading" className="text-sm font-bold text-[#20242c]">Optional module groups</h4>
          <p className="text-xs text-[#75695d]">Describe WLAN, rear I/O, Flex IO, and other OEM module positions.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Add optional module group"
          onClick={() => onChange([...groups, {
            draftKey: createResourceGroupDraftKey('optional-module'),
            key: '',
            label: '',
            count: '',
            acceptedModuleKinds: [],
          }])}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add group
        </Button>
      </div>
      {groups.map((group, index) => (
        <div key={group.draftKey} className="space-y-3 rounded-md border border-[#ded8ce] bg-white p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <TextField label={`Optional module group ${index + 1} label`} name={`optional-module-group-${group.draftKey}-label`} value={group.label} placeholder="Optional rear I/O" onChange={(label) => updateGroup(group.draftKey, { label })} />
            <TextField
              label="Count"
              ariaLabel={`Optional module group ${index + 1} count`}
              name={`optional-module-group-${group.draftKey}-count`}
              value={group.count}
              type="number"
              min={1}
              placeholder="1"
              error={validationTarget?.index === index ? error : undefined}
              onChange={(count) => updateGroup(group.draftKey, { count })}
            />
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove optional module group ${index + 1}`} onClick={() => onChange(groups.filter((entry) => entry.draftKey !== group.draftKey))}>
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <CheckboxOptions label={`Optional module group ${index + 1} accepted kinds`} options={OPTIONAL_MODULE_KINDS} selected={group.acceptedModuleKinds} onChange={(acceptedModuleKinds) => updateGroup(group.draftKey, { acceptedModuleKinds })} />
        </div>
      ))}
      {!validationTarget ? <FieldError message={error} /> : null}
    </section>
  )
}

export function MotherboardPowerConnectorsEditor({
  groups,
  error,
  onChange,
  onSelectOpenChange,
}: {
  groups: MotherboardPowerConnectorDraft[]
  error?: string
  onChange: (groups: MotherboardPowerConnectorDraft[]) => void
  onSelectOpenChange?: (open: boolean) => void
}) {
  const validationTarget = error ? getMotherboardPowerConnectorValidationTarget(groups) : null
  const updateGroup = (draftKey: string, patch: Partial<MotherboardPowerConnectorDraft>) => {
    onChange(groups.map((group) => group.draftKey === draftKey ? { ...group, ...patch } : group))
  }

  return (
    <section aria-labelledby="motherboard-power-connectors-heading" className="space-y-3 rounded-md border border-[#e4d9c9] bg-[#fbf8f2] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id="motherboard-power-connectors-heading" className="text-sm font-bold text-[#20242c]">Board power connectors</h4>
          <p className="text-xs text-[#75695d]">Define required PSU leads. These are internal PC Build resources, not canvas power endpoints.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Add motherboard power connector"
          onClick={() => onChange([...groups, {
            draftKey: createResourceGroupDraftKey('power-connector'),
            key: '',
            label: '',
            kind: '',
            connector: '',
            count: '',
            required: true,
          }])}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add connector
        </Button>
      </div>
      {groups.map((group, index) => (
        <div key={group.draftKey} className="space-y-3 rounded-md border border-[#ded8ce] bg-white p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={`Power connector ${index + 1} label`} name={`power-connector-${group.draftKey}-label`} value={group.label} placeholder="Main ATX power" onChange={(label) => updateGroup(group.draftKey, { label })} />
            <SelectField label="Purpose" name={`power-connector-${group.draftKey}-kind`} value={group.kind} options={[{ value: 'main-power', label: 'Main board power' }, { value: 'cpu-power', label: 'CPU power' }]} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(kind) => updateGroup(group.draftKey, { kind: kind as MotherboardPowerConnectorDraft['kind'] })} />
            <TextField label="Connector" name={`power-connector-${group.draftKey}-connector`} value={group.connector} placeholder="24-pin ATX" onChange={(connector) => updateGroup(group.draftKey, { connector })} />
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
              <TextField label="Count" ariaLabel={`Power connector ${index + 1} count`} name={`power-connector-${group.draftKey}-count`} value={group.count} type="number" min={1} placeholder="1" error={validationTarget?.index === index ? error : undefined} onChange={(count) => updateGroup(group.draftKey, { count })} />
              <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-[#3d3832]">
                <Input type="checkbox" className="size-4 rounded-none" checked={group.required} onChange={(event) => updateGroup(group.draftKey, { required: event.target.checked })} />
                Required
              </label>
              <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove power connector ${index + 1}`} onClick={() => onChange(groups.filter((entry) => entry.draftKey !== group.draftKey))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ))}
      {!validationTarget ? <FieldError message={error} /> : null}
    </section>
  )
}
