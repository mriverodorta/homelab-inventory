import { Input } from '@/components/ui/input'
import type { InventoryType } from '@/types/inventory'
import { FieldError, FieldLabel, SelectField, TextField } from './field-primitives'
import type { InventoryFormErrors, InventoryFormValues } from './model'
import { PcComponentFields } from './pc-component-fields'
import { PowerEquipmentFields } from './power-equipment-fields'
import { getInventoryFormPlaceholders } from './placeholders'
import {
  CPU_MANUFACTURERS,
  GPU_FORM_FACTORS,
  GPU_MANUFACTURERS,
  GPU_SLOT_WIDTHS,
  NETWORK_FORM_FACTORS,
  NETWORK_INTERFACES,
  NETWORK_SLOTS,
  NAS_POWER_CONFIGURATION_OPTIONS,
  PCIE_OPTIONS,
  RAM_GENERATIONS,
  RAM_SPEEDS,
  SERVER_FORM_FACTORS,
  STORAGE_FORM_FACTORS,
  STORAGE_INTERFACES,
  SWITCH_MANAGEMENT_OPTIONS,
  WIRELESS_OPTIONS,
} from './options'

export type InventoryFieldChangeMode = 'debounced' | 'immediate'

export type InventoryTypeFieldsProps = {
  type: InventoryType
  values: InventoryFormValues
  errors?: InventoryFormErrors
  onChange: (patch: Partial<InventoryFormValues>, mode?: InventoryFieldChangeMode) => void
  onSelectOpenChange?: (open: boolean) => void
}

export function InventoryCommonFields({
  type,
  values,
  errors = {},
  onChange,
  onSelectOpenChange,
}: InventoryTypeFieldsProps) {
  const placeholders = getInventoryFormPlaceholders(type)
  const manufacturerOptions = type === 'cpu'
    ? CPU_MANUFACTURERS
    : type === 'gpu'
      ? GPU_MANUFACTURERS
      : null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        label="Name"
        name="name"
        value={values.name}
        required
        error={errors.name}
        placeholder={placeholders.name}
        onChange={(name) => onChange({ name })}
      />
      {manufacturerOptions ? (
        <SelectField
          label="Manufacturer"
          name="manufacturer"
          value={values.manufacturer}
          placeholder={placeholders.manufacturer}
          options={manufacturerOptions}
          onOpenChange={onSelectOpenChange}
          onValueChange={(manufacturer) => onChange({ manufacturer }, 'immediate')}
        />
      ) : (
        <TextField
          label="Manufacturer"
          name="manufacturer"
          value={values.manufacturer}
          placeholder={placeholders.manufacturer}
          onChange={(manufacturer) => onChange({ manufacturer })}
        />
      )}
      <TextField
        label="Model"
        name="model"
        value={values.model}
        placeholder={placeholders.model}
        onChange={(model) => onChange({ model })}
      />
    </div>
  )
}

export function InventoryTypeFields({
  type,
  values,
  errors = {},
  onChange,
  onSelectOpenChange,
}: InventoryTypeFieldsProps) {
  const placeholders = getInventoryFormPlaceholders(type)

  if (['pcBuild', 'motherboard', 'cpuCooler', 'case', 'powerSupply', 'soundCard', 'wireless'].includes(type)) {
    return <PcComponentFields type={type} values={values} errors={errors} onChange={onChange} onSelectOpenChange={onSelectOpenChange} />
  }

  if (['powerAdapter', 'monitor', 'ups', 'powerStrip'].includes(type)) {
    return <PowerEquipmentFields type={type} values={values} errors={errors} onChange={onChange} onSelectOpenChange={onSelectOpenChange} />
  }

  if (type === 'cpu') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Family" name="family" value={values.family} placeholder={placeholders.family} onChange={(family) => onChange({ family })} />
        <TextField label="Number" name="number" value={values.number} placeholder={placeholders.number} onChange={(number) => onChange({ number })} />
        <TextField label="Cores" name="cores" value={values.cores} placeholder={placeholders.cores} type="number" min={1} error={errors.cores} onChange={(cores) => onChange({ cores })} />
        <TextField label="Threads" name="threads" value={values.threads} placeholder={placeholders.threads} type="number" min={1} error={errors.threads} onChange={(threads) => onChange({ threads })} />
        <TextField label="Base Clock" name="baseClockGhz" value={values.baseClockGhz} placeholder={placeholders.baseClockGhz} type="number" min={0} step="0.1" error={errors.baseClockGhz} onChange={(baseClockGhz) => onChange({ baseClockGhz })} />
        <TextField label="Boost Clock" name="boostClockGhz" value={values.boostClockGhz} placeholder={placeholders.boostClockGhz} type="number" min={0} step="0.1" error={errors.boostClockGhz} onChange={(boostClockGhz) => onChange({ boostClockGhz })} />
      </div>
    )
  }

  if (type === 'ram') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Capacity GB" name="capacityGb" value={values.capacityGb} placeholder={placeholders.capacityGb} type="number" min={1} error={errors.capacityGb} onChange={(capacityGb) => onChange({ capacityGb })} />
        <SelectField label="Generation" name="generation" value={values.generation} placeholder="Select generation" options={RAM_GENERATIONS} onOpenChange={onSelectOpenChange} onValueChange={(generation) => onChange({ generation }, 'immediate')} />
        <SelectField label="Stick 1 Speed" name="speedMt" value={values.speedMt} placeholder="Select speed" options={RAM_SPEEDS} emptyLabel="Empty" onOpenChange={onSelectOpenChange} onValueChange={(speedMt) => onChange({ speedMt }, 'immediate')} />
        <TextField label="Stick 2 Manufacturer" name="secondaryManufacturer" value={values.secondaryManufacturer} placeholder={placeholders.secondaryManufacturer} onChange={(secondaryManufacturer) => onChange({ secondaryManufacturer })} />
        <SelectField label="Stick 2 Speed" name="secondarySpeedMt" value={values.secondarySpeedMt} placeholder="Same as stick 1" options={RAM_SPEEDS} emptyLabel="Same as stick 1" onOpenChange={onSelectOpenChange} onValueChange={(secondarySpeedMt) => onChange({ secondarySpeedMt }, 'immediate')} />
      </div>
    )
  }

  if (type === 'storage') {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField className="sm:col-span-2" label="Capacity" name="capacity" value={values.capacity} placeholder={placeholders.capacity} type="number" min={0} step="0.1" error={errors.capacity} onChange={(capacity) => onChange({ capacity })} />
        <SelectField label="Unit" name="storageUnit" value={values.storageUnit} options={['TB', 'GB']} onOpenChange={onSelectOpenChange} onValueChange={(storageUnit) => onChange({ storageUnit: storageUnit as 'GB' | 'TB' }, 'immediate')} />
        <SelectField label="Interface" name="interface" value={values.interface} placeholder="Select interface" options={STORAGE_INTERFACES} onOpenChange={onSelectOpenChange} onValueChange={(interfaceName) => onChange({ interface: interfaceName }, 'immediate')} />
        <SelectField label="Form Factor" name="storageFormFactor" value={values.storageFormFactor} placeholder="Select size" options={STORAGE_FORM_FACTORS} emptyLabel="None" onOpenChange={onSelectOpenChange} onValueChange={(storageFormFactor) => onChange({ storageFormFactor }, 'immediate')} />
      </div>
    )
  }

  if (type === 'server') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Form Factor" name="formFactor" value={values.formFactor} placeholder="Select size" options={SERVER_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(formFactor) => onChange({ formFactor }, 'immediate')} />
        <SelectField label="Network Slot" name="networkSlot" value={values.networkSlot} placeholder="Select slot" options={NETWORK_SLOTS} onOpenChange={onSelectOpenChange} onValueChange={(networkSlot) => onChange({ networkSlot }, 'immediate')} />
        <SelectField label="Wireless" name="wireless" value={values.wireless} placeholder="Select" options={WIRELESS_OPTIONS} onOpenChange={onSelectOpenChange} onValueChange={(wireless) => onChange({ wireless }, 'immediate')} />
      </div>
    )
  }

  if (type === 'nas') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Drive Bays" name="driveBays" value={values.driveBays} placeholder={placeholders.driveBays} type="number" min={0} error={errors.driveBays} onChange={(driveBays) => onChange({ driveBays })} />
        <TextField label="M.2 Slots" name="m2Slots" value={values.m2Slots} placeholder={placeholders.m2Slots} type="number" min={0} error={errors.m2Slots} onChange={(m2Slots) => onChange({ m2Slots })} />
        <SelectField
          label="Power configuration"
          name="powerConfiguration"
          value={values.powerConfiguration}
          placeholder="Select power configuration"
          options={NAS_POWER_CONFIGURATION_OPTIONS}
          error={errors.powerConfiguration}
          onOpenChange={onSelectOpenChange}
          onValueChange={(powerConfiguration) => onChange({
            powerConfiguration: powerConfiguration as InventoryFormValues['powerConfiguration'],
          }, 'immediate')}
        />
      </div>
    )
  }

  if (type === 'gpu') {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField label="VRAM GB" name="vramGb" value={values.vramGb} placeholder={placeholders.vramGb} type="number" min={0} error={errors.vramGb} onChange={(vramGb) => onChange({ vramGb })} />
        <SelectField label="Form Factor" name="gpuFormFactor" value={values.gpuFormFactor} placeholder="Select form factor" options={GPU_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(gpuFormFactor) => onChange({ gpuFormFactor }, 'immediate')} />
        <SelectField label="Slot Width" name="slotWidth" value={values.slotWidth} placeholder="Select width" options={GPU_SLOT_WIDTHS} onOpenChange={onSelectOpenChange} onValueChange={(slotWidth) => onChange({ slotWidth }, 'immediate')} />
        <SelectField label="PCIe" name="pcie" value={values.pcie} placeholder="Select PCIe" options={PCIE_OPTIONS} onOpenChange={onSelectOpenChange} onValueChange={(pcie) => onChange({ pcie }, 'immediate')} />
      </div>
    )
  }

  if (type === 'network') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Interface" name="interface" value={values.interface} placeholder="Select interface" options={NETWORK_INTERFACES} onOpenChange={onSelectOpenChange} onValueChange={(interfaceName) => onChange({ interface: interfaceName }, 'immediate')} />
        <SelectField label="Form Factor" name="networkFormFactor" value={values.networkFormFactor} placeholder="Select form factor" options={NETWORK_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(networkFormFactor) => onChange({ networkFormFactor }, 'immediate')} />
      </div>
    )
  }

  if (type === 'switch') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Management" name="management" value={values.management} placeholder="Select management" options={SWITCH_MANAGEMENT_OPTIONS} onOpenChange={onSelectOpenChange} onValueChange={(management) => onChange({ management }, 'immediate')} />
        <TextField label="Switching Gbps" name="switchingCapacityGbps" value={values.switchingCapacityGbps} placeholder={placeholders.switchingCapacityGbps} type="number" min={0} error={errors.switchingCapacityGbps} onChange={(switchingCapacityGbps) => onChange({ switchingCapacityGbps })} />
        <FieldLabel className="flex items-center gap-2 self-end px-1 py-2 text-sm text-[#20242c]">
          <Input name="fanless" type="checkbox" checked={values.fanless} className="size-4 rounded-none" onChange={(event) => onChange({ fanless: event.target.checked }, 'immediate')} />
          <span>Fanless</span>
        </FieldLabel>
      </div>
    )
  }

  if (type === 'patchPanel') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Rack Units" name="rackUnits" value={values.rackUnits} type="number" min={0} step="0.5" error={errors.rackUnits} placeholder={placeholders.rackUnits} onChange={(rackUnits) => onChange({ rackUnits })} />
        <TextField label="Mount" name="mount" value={values.mount} placeholder={placeholders.mount} onChange={(mount) => onChange({ mount })} />
      </div>
    )
  }

  return <FieldError message={errors.type} />
}
