import { Input } from '@/components/ui/input'
import { SelectField, TextField } from './field-primitives'
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
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Form Factor" name="formFactor" value={values.formFactor} placeholder="Select form factor" options={MOTHERBOARD_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(formFactor) => onChange({ formFactor }, 'immediate')} />
        <TextField label="CPU Socket Count" name="cpuSocketCount" value={values.cpuSocketCount} placeholder="1" type="number" min={1} error={errors.cpuSocketCount} onChange={(cpuSocketCount) => onChange({ cpuSocketCount })} />
      </div>
    )
  }

  if (type === 'cpuCooler') {
    return <SelectField label="Cooler Type" name="coolerType" value={values.coolerType} placeholder="Select cooler type" options={COOLER_TYPES} onOpenChange={onSelectOpenChange} onValueChange={(coolerType) => onChange({ coolerType: coolerType as typeof values.coolerType }, 'immediate')} />
  }

  if (type === 'case') return <CaseFormFactorFields {...props} />

  if (type === 'powerSupply') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="PSU Form Factor" name="psuFormFactor" value={values.psuFormFactor} placeholder="Select form factor" options={PSU_FORM_FACTORS} onOpenChange={onSelectOpenChange} onValueChange={(psuFormFactor) => onChange({ psuFormFactor }, 'immediate')} />
        <TextField label="Rated Watts" name="ratedWatts" value={values.ratedWatts} placeholder="750" type="number" min={0} error={errors.ratedWatts} onChange={(ratedWatts) => onChange({ ratedWatts })} />
        <SelectField label="Efficiency Rating" name="efficiencyRating" value={values.efficiencyRating} placeholder="Select efficiency" options={POWER_EFFICIENCY_RATINGS} onOpenChange={onSelectOpenChange} onValueChange={(efficiencyRating) => onChange({ efficiencyRating }, 'immediate')} />
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
