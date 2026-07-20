import { SelectField, TextField } from './field-primitives'
import type { InventoryTypeFieldsProps } from './type-fields'
import { DC_CONNECTORS, YES_NO_OPTIONS } from './options'

export function PowerEquipmentFields({
  type,
  values,
  errors = {},
  onChange,
  onSelectOpenChange,
}: InventoryTypeFieldsProps) {
  if (type === 'powerAdapter') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Output Watts" name="adapterOutputWatts" value={values.adapterOutputWatts} placeholder="90" type="number" min={0} error={errors.adapterOutputWatts} onChange={(adapterOutputWatts) => onChange({ adapterOutputWatts })} />
        <SelectField label="DC Connector" name="dcConnector" value={values.dcConnector} placeholder="Select connector" options={DC_CONNECTORS} onOpenChange={onSelectOpenChange} onValueChange={(dcConnector) => onChange({ dcConnector }, 'immediate')} />
      </div>
    )
  }

  if (type === 'monitor') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Display Size (inches)" name="displaySizeInches" value={values.displaySizeInches} placeholder="27" type="number" min={0} step="0.1" error={errors.displaySizeInches} onChange={(displaySizeInches) => onChange({ displaySizeInches })} />
        <TextField label="Resolution" name="resolution" value={values.resolution} placeholder="3840x2160" onChange={(resolution) => onChange({ resolution })} />
        <TextField label="Refresh Rate (Hz)" name="refreshRateHz" value={values.refreshRateHz} placeholder="60" type="number" min={0} error={errors.refreshRateHz} onChange={(refreshRateHz) => onChange({ refreshRateHz })} />
      </div>
    )
  }

  if (type === 'ups') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Output Watts" name="upsWatts" value={values.upsWatts} placeholder="900" type="number" min={0} error={errors.upsWatts} onChange={(upsWatts) => onChange({ upsWatts })} />
        <TextField label="Capacity (VA)" name="upsVoltAmps" value={values.upsVoltAmps} placeholder="1500" type="number" min={0} error={errors.upsVoltAmps} onChange={(upsVoltAmps) => onChange({ upsVoltAmps })} />
        <TextField label="Battery Backup Outlets" name="batteryOutletCount" value={values.batteryOutletCount} placeholder="5" type="number" min={0} error={errors.batteryOutletCount} onChange={(batteryOutletCount) => onChange({ batteryOutletCount })} />
        <TextField label="Surge Protection Outlets" name="surgeOutletCount" value={values.surgeOutletCount} placeholder="5" type="number" min={0} error={errors.surgeOutletCount} onChange={(surgeOutletCount) => onChange({ surgeOutletCount })} />
      </div>
    )
  }

  if (type === 'powerStrip') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Outlet Count" name="outletCount" value={values.outletCount} placeholder="6" type="number" min={0} error={errors.outletCount} onChange={(outletCount) => onChange({ outletCount })} />
        <SelectField label="Surge Protected" name="surgeProtected" value={values.surgeProtected === 'yes' ? 'Yes' : values.surgeProtected === 'no' ? 'No' : ''} placeholder="Select" options={YES_NO_OPTIONS} onOpenChange={onSelectOpenChange} onValueChange={(surgeProtected) => onChange({ surgeProtected: surgeProtected.toLowerCase() as typeof values.surgeProtected }, 'immediate')} />
      </div>
    )
  }

  return null
}
