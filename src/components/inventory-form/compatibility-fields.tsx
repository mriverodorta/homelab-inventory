import { Cpu, MemoryStick, Puzzle, ServerCog } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FieldLabel, SelectField, TextField } from './field-primitives'
import type { InventoryFormErrors, InventoryFormValues } from './model'
import {
  CARD_HEIGHTS,
  CPU_GENERATIONS,
  CPU_SOCKET_SUGGESTIONS,
  EXPANSION_INTERFACE_FAMILIES,
  PCIE_GENERATIONS,
  PCIE_LANE_WIDTHS,
  RAM_GENERATIONS,
  SLOT_WIDTHS,
  fieldClassName,
} from './options'
import {
  ExpansionSlotGroupsEditor,
  StorageSlotGroupsEditor,
} from './resource-group-editor'
import type { InventoryFieldChangeMode } from './type-fields'

export type CompatibilityFieldsProps = {
  values: InventoryFormValues
  errors?: InventoryFormErrors
  onChange: (
    patch: Partial<InventoryFormValues>,
    mode?: InventoryFieldChangeMode,
  ) => void
  onSelectOpenChange?: (open: boolean) => void
}

function MultiOptionField({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  return (
    <fieldset className="space-y-2 sm:col-span-full">
      <legend className="text-xs font-bold text-[#75695d]">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
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

function SectionHeading({ icon: Icon, children }: { icon: typeof Cpu; children: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden="true" className="size-4 text-[#75695d]" />
      <h4 className="text-xs font-extrabold uppercase text-[#75695d]">{children}</h4>
    </div>
  )
}

function HostCompatibilityFields({
  values,
  errors = {},
  onChange,
  onSelectOpenChange,
}: CompatibilityFieldsProps) {
  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <SectionHeading icon={Cpu}>Processor support</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldLabel className="sm:col-span-2">
            <span>Supported CPU sockets</span>
            <Input
              aria-label="Supported CPU sockets"
              list="compatibility-cpu-sockets"
              value={values.hostCpuSockets.join(', ')}
              placeholder="LGA1200"
              className={fieldClassName()}
              onChange={(event) => onChange({
                hostCpuSockets: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
              })}
            />
            <datalist id="compatibility-cpu-sockets">
              {CPU_SOCKET_SUGGESTIONS.map((socket) => <option key={socket} value={socket} />)}
            </datalist>
          </FieldLabel>
          <TextField label="Maximum CPU TDP (W)" name="hostCpuMaxTdpWatts" value={values.hostCpuMaxTdpWatts} type="number" min={0} placeholder="65" error={errors.hostCpuMaxTdpWatts} onChange={(hostCpuMaxTdpWatts) => onChange({ hostCpuMaxTdpWatts })} />
          <MultiOptionField label="Supported CPU generations" options={CPU_GENERATIONS} selected={values.hostCpuGenerations} onChange={(hostCpuGenerations) => onChange({ hostCpuGenerations }, 'immediate')} />
        </div>
      </section>

      <section className="space-y-3 border-t border-[#e4d9c9] pt-4">
        <SectionHeading icon={MemoryStick}>Memory support</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-4">
          <MultiOptionField label="Supported RAM generations" options={RAM_GENERATIONS} selected={values.hostMemoryGenerations} onChange={(hostMemoryGenerations) => onChange({ hostMemoryGenerations }, 'immediate')} />
          <TextField label="Memory slots" name="hostMemorySlots" value={values.hostMemorySlots} type="number" min={1} placeholder="2" error={errors.hostMemorySlots} onChange={(hostMemorySlots) => onChange({ hostMemorySlots })} />
          <TextField label="Maximum capacity (GB)" name="hostMemoryMaxCapacityGb" value={values.hostMemoryMaxCapacityGb} type="number" min={0} placeholder="64" error={errors.hostMemoryMaxCapacityGb} onChange={(hostMemoryMaxCapacityGb) => onChange({ hostMemoryMaxCapacityGb })} />
          <TextField label="Maximum module (GB)" name="hostMemoryMaxModuleCapacityGb" value={values.hostMemoryMaxModuleCapacityGb} type="number" min={0} placeholder="32" error={errors.hostMemoryMaxModuleCapacityGb} onChange={(hostMemoryMaxModuleCapacityGb) => onChange({ hostMemoryMaxModuleCapacityGb })} />
          <TextField label="Maximum speed (MT/s)" name="hostMemoryMaxSpeedMt" value={values.hostMemoryMaxSpeedMt} type="number" min={0} placeholder="3200" error={errors.hostMemoryMaxSpeedMt} onChange={(hostMemoryMaxSpeedMt) => onChange({ hostMemoryMaxSpeedMt })} />
        </div>
      </section>

      <section className="space-y-3 border-t border-[#e4d9c9] pt-4">
        <SectionHeading icon={ServerCog}>Host resources</SectionHeading>
        <StorageSlotGroupsEditor groups={values.storageSlotGroups} error={errors.storageSlotGroups} onChange={(storageSlotGroups) => onChange({ storageSlotGroups }, 'immediate')} onSelectOpenChange={onSelectOpenChange} />
        <ExpansionSlotGroupsEditor groups={values.expansionSlotGroups} error={errors.expansionSlotGroups} onChange={(expansionSlotGroups) => onChange({ expansionSlotGroups }, 'immediate')} onSelectOpenChange={onSelectOpenChange} />
        <TextField label="Total expansion power (W)" name="hostMaxExpansionPowerWatts" value={values.hostMaxExpansionPowerWatts} type="number" min={0} placeholder="100" error={errors.hostMaxExpansionPowerWatts} onChange={(hostMaxExpansionPowerWatts) => onChange({ hostMaxExpansionPowerWatts })} />
      </section>
    </div>
  )
}

function CpuCompatibilityFields({ values, errors = {}, onChange, onSelectOpenChange }: CompatibilityFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SelectField label="CPU socket" name="cpuSocket" value={values.cpuSocket} options={CPU_SOCKET_SUGGESTIONS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(cpuSocket) => onChange({ cpuSocket }, 'immediate')} />
      <SelectField label="CPU generation" name="cpuGeneration" value={values.cpuGeneration} options={CPU_GENERATIONS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(cpuGeneration) => onChange({ cpuGeneration }, 'immediate')} />
      <TextField label="TDP (W)" name="cpuTdpWatts" value={values.cpuTdpWatts} type="number" min={0} placeholder="35" error={errors.cpuTdpWatts} onChange={(cpuTdpWatts) => onChange({ cpuTdpWatts })} />
    </div>
  )
}

function ExpansionCompatibilityFields({ values, errors = {}, onChange, onSelectOpenChange }: CompatibilityFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SelectField label="Expansion interface" name="expansionInterfaceFamily" value={values.expansionInterfaceFamily} options={EXPANSION_INTERFACE_FAMILIES} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(expansionInterfaceFamily) => onChange({ expansionInterfaceFamily }, 'immediate')} />
      <SelectField label="PCIe generation" name="expansionPcieGeneration" value={values.expansionPcieGeneration} options={PCIE_GENERATIONS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(expansionPcieGeneration) => onChange({ expansionPcieGeneration }, 'immediate')} />
      <SelectField label="Connector lanes" name="expansionConnectorLanes" value={values.expansionConnectorLanes} options={PCIE_LANE_WIDTHS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(expansionConnectorLanes) => onChange({ expansionConnectorLanes }, 'immediate')} />
      <SelectField label="Minimum electrical lanes" name="expansionMinimumElectricalLanes" value={values.expansionMinimumElectricalLanes} options={PCIE_LANE_WIDTHS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(expansionMinimumElectricalLanes) => onChange({ expansionMinimumElectricalLanes }, 'immediate')} />
      <SelectField label="Card height" name="expansionHeight" value={values.expansionHeight} options={CARD_HEIGHTS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(expansionHeight) => onChange({ expansionHeight }, 'immediate')} />
      <SelectField label="Slot width" name="expansionSlotWidth" value={values.expansionSlotWidth} options={SLOT_WIDTHS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(expansionSlotWidth) => onChange({ expansionSlotWidth }, 'immediate')} />
      <TextField label="Card power (W)" name="expansionPowerWatts" value={values.expansionPowerWatts} type="number" min={0} placeholder="75" error={errors.expansionPowerWatts} onChange={(expansionPowerWatts) => onChange({ expansionPowerWatts })} />
    </div>
  )
}

export function CompatibilityFields(props: CompatibilityFieldsProps) {
  const { values, errors = {}, onChange } = props
  const supported = ['server', 'nas', 'cpu', 'ram', 'gpu', 'network'].includes(values.type)
  if (!supported) return null

  return (
    <section aria-labelledby="compatibility-heading" className="space-y-4 border-t border-[#ded8ce] pt-4">
      <div className="flex items-center gap-2">
        <Puzzle aria-hidden="true" className="size-4 text-[#75695d]" />
        <h3 id="compatibility-heading" className="text-sm font-extrabold uppercase text-[#75695d]">Compatibility</h3>
      </div>
      {(values.type === 'server' || values.type === 'nas') ? <HostCompatibilityFields {...props} /> : null}
      {values.type === 'cpu' ? <CpuCompatibilityFields {...props} /> : null}
      {values.type === 'ram' ? (
        <TextField label="Module count" name="moduleCount" value={values.moduleCount} type="number" min={1} placeholder="2" error={errors.moduleCount} onChange={(moduleCount) => onChange({ moduleCount })} />
      ) : null}
      {(values.type === 'gpu' || values.type === 'network') ? <ExpansionCompatibilityFields {...props} /> : null}
    </section>
  )
}
