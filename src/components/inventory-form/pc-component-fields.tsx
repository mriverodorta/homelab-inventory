import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel, SelectField, TextField } from './field-primitives'
import type { InventoryTypeFieldsProps } from './type-fields'
import {
  COOLER_TYPES,
  MOTHERBOARD_FORM_FACTORS,
  POWER_EFFICIENCY_RATINGS,
  PSU_FORM_FACTORS,
  SOUND_CARD_INTERFACES,
  WIFI_GENERATIONS,
  WIRELESS_INTERFACES,
  YES_NO_OPTIONS,
} from './options'

function CaseFormFactorFields({ values, onChange }: InventoryTypeFieldsProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-bold text-[#75695d]">Supported motherboard form factors</legend>
      <div className="flex flex-wrap gap-2">
        {MOTHERBOARD_FORM_FACTORS.map((formFactor) => (
          <label key={formFactor} className="flex min-h-9 items-center gap-2 rounded-md border border-[#ded8ce] bg-[#fffdf8] px-3 text-xs font-semibold text-[#3d3832]">
            <Input
              aria-label={`Supported motherboard form factor: ${formFactor}`}
              type="checkbox"
              checked={values.caseFormFactors.includes(formFactor)}
              className="size-4 rounded-none"
              onChange={(event) => onChange({
                caseFormFactors: event.target.checked
                  ? [...values.caseFormFactors, formFactor]
                  : values.caseFormFactors.filter((value) => value !== formFactor),
              }, 'immediate')}
            />
            <span>{formFactor}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function PcComponentFields(props: InventoryTypeFieldsProps) {
  const { type, values, errors = {}, onChange, onSelectOpenChange } = props

  if (type === 'pcBuild') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Operating System" name="operatingSystem" value={values.operatingSystem} placeholder="Windows 11 Pro" onChange={(operatingSystem) => onChange({ operatingSystem })} />
        <TextField label="Role" name="role" value={values.role} placeholder="Gaming" onChange={(role) => onChange({ role })} />
      </div>
    )
  }

  if (type === 'motherboard') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Family" name="family" value={values.family} placeholder="Prime" onChange={(family) => onChange({ family })} />
        <TextField label="Chipset" name="chipset" value={values.chipset} placeholder="Intel Z690" onChange={(chipset) => onChange({ chipset })} />
        <SelectField label="Form Factor" name="formFactor" value={values.formFactor} placeholder="Select form factor" options={MOTHERBOARD_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(formFactor) => onChange({ formFactor }, 'immediate')} />
        <TextField label="Board Revision" name="boardRevision" value={values.boardRevision} placeholder="1.0" onChange={(boardRevision) => onChange({ boardRevision })} />
        <TextField label="Launch Date" name="launchDate" value={values.launchDate} type="date" onChange={(launchDate) => onChange({ launchDate })} />
        <SelectField label="Discontinued" name="discontinued" value={values.discontinued} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(discontinued) => onChange({ discontinued: discontinued as typeof values.discontinued }, 'immediate')} />
        <SelectField label="Wi-Fi Generation" name="wifiGeneration" value={values.wifiGeneration} placeholder="Select Wi-Fi generation" options={WIFI_GENERATIONS} emptyLabel="Not specified" onOpenChange={onSelectOpenChange} onValueChange={(wifiGeneration) => onChange({ wifiGeneration }, 'immediate')} />
        <TextField label="Bluetooth" name="motherboardBluetooth" value={values.motherboardBluetooth} placeholder="Bluetooth 5.3" onChange={(motherboardBluetooth) => onChange({ motherboardBluetooth })} />
        <FieldLabel className="sm:col-span-full">
          <span>Aliases</span>
          <Input
            aria-label="Motherboard aliases"
            value={values.aliases.join(',')}
            placeholder="PRIME Z690-P D4-CSM"
            onChange={(event) => onChange({ aliases: event.target.value.split(',') })}
          />
        </FieldLabel>
      </div>
    )
  }

  if (type === 'cpuCooler') {
    return <SelectField label="Cooler Type" name="coolerType" value={values.coolerType} placeholder="Select cooler type" options={COOLER_TYPES} onOpenChange={onSelectOpenChange} onValueChange={(coolerType) => onChange({ coolerType: coolerType as typeof values.coolerType }, 'immediate')} />
  }

  if (type === 'case') return <CaseFormFactorFields {...props} />

  if (type === 'powerSupply') {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="PSU Form Factor" name="psuFormFactor" value={values.psuFormFactor} placeholder="Select form factor" options={PSU_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(psuFormFactor) => onChange({ psuFormFactor }, 'immediate')} />
          <TextField label="Rated Watts" name="ratedWatts" value={values.ratedWatts} placeholder="750" type="number" min={0} error={errors.ratedWatts} onChange={(ratedWatts) => onChange({ ratedWatts })} />
          <SelectField label="Efficiency Rating" name="efficiencyRating" value={values.efficiencyRating} placeholder="Select efficiency" options={POWER_EFFICIENCY_RATINGS} onOpenChange={onSelectOpenChange} onValueChange={(efficiencyRating) => onChange({ efficiencyRating }, 'immediate')} />
        </div>
        <section className="space-y-3 rounded-md border border-[#e4d9c9] bg-[#fbf8f2] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-[#20242c]">Motherboard power leads</h4>
              <p className="text-xs text-[#75695d]">List the ATX and CPU power connectors available from this PSU.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange({ powerSupplyConnectors: [...values.powerSupplyConnectors, { draftKey: `psu-${Date.now()}`, connector: '', count: '' }] }, 'immediate')}>
              <Plus aria-hidden="true" className="size-4" />
              Add lead
            </Button>
          </div>
          {values.powerSupplyConnectors.map((lead, index) => (
            <div key={lead.draftKey} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
              <TextField label={`Connector ${index + 1}`} name={`psu-lead-${lead.draftKey}`} value={lead.connector} placeholder="8-pin EPS" onChange={(connector) => onChange({ powerSupplyConnectors: values.powerSupplyConnectors.map((candidate) => candidate.draftKey === lead.draftKey ? { ...candidate, connector } : candidate) })} />
              <TextField label="Count" name={`psu-lead-${lead.draftKey}-count`} value={lead.count} type="number" min={1} placeholder="1" error={errors.powerSupplyConnectors} onChange={(count) => onChange({ powerSupplyConnectors: values.powerSupplyConnectors.map((candidate) => candidate.draftKey === lead.draftKey ? { ...candidate, count } : candidate) })} />
              <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove PSU lead ${index + 1}`} onClick={() => onChange({ powerSupplyConnectors: values.powerSupplyConnectors.filter((candidate) => candidate.draftKey !== lead.draftKey) }, 'immediate')}>
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
        </section>
      </div>
    )
  }

  if (type === 'soundCard') {
    return <SelectField label="Interface" name="interface" value={values.interface} placeholder="Select interface" options={SOUND_CARD_INTERFACES} onOpenChange={onSelectOpenChange} onValueChange={(interfaceName) => onChange({ interface: interfaceName }, 'immediate')} />
  }

  if (type === 'wireless') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Interface" name="interface" value={values.interface} placeholder="Select interface" options={WIRELESS_INTERFACES} onOpenChange={onSelectOpenChange} onValueChange={(interfaceName) => onChange({ interface: interfaceName }, 'immediate')} />
        <SelectField label="Wi-Fi Generation" name="wifiGeneration" value={values.wifiGeneration} placeholder="Select Wi-Fi generation" options={WIFI_GENERATIONS} onOpenChange={onSelectOpenChange} onValueChange={(wifiGeneration) => onChange({ wifiGeneration }, 'immediate')} />
        <SelectField label="Bluetooth" name="bluetooth" value={values.bluetooth === 'yes' ? 'Yes' : values.bluetooth === 'no' ? 'No' : ''} placeholder="Select" options={YES_NO_OPTIONS} onOpenChange={onSelectOpenChange} onValueChange={(bluetooth) => onChange({ bluetooth: bluetooth.toLowerCase() as typeof values.bluetooth }, 'immediate')} />
      </div>
    )
  }

  return null
}
