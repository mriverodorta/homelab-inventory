import { TextField } from '@/components/inventory-form/field-primitives'
import {
  powerStripOutletPorts,
  type InventoryFormValues,
} from '@/components/inventory-form/model'
import { Switch } from '@/components/ui/switch'

export function SmartPowerStripFields({
  values,
  onChange,
  onDisableRequest,
}: {
  values: InventoryFormValues
  onChange: (
    patch: Partial<InventoryFormValues>,
    mode?: 'debounced' | 'immediate',
  ) => void
  onDisableRequest: () => void
}) {
  const outletPorts = powerStripOutletPorts(values)
  const namesByPortId = new Map(values.smartOutletNames.map((entry) => [entry.portId, entry.name]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-[#ded8ce] bg-[#f8f3eb] p-3">
        <div>
          <div className="text-sm font-bold text-[#20242c]">Smart power strip</div>
          <div className="mt-0.5 text-xs font-medium text-[#75695d]">
            Store management identity and custom outlet names.
          </div>
        </div>
        <Switch
          aria-label="Smart power strip"
          checked={values.smartEnabled}
          onCheckedChange={(checked) => {
            if (!checked) {
              onDisableRequest()
              return
            }
            onChange({ smartEnabled: true }, 'immediate')
          }}
        />
      </div>

      {values.smartEnabled ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Device display name" name="smartDisplayName" value={values.smartDisplayName} placeholder="Rack power" onChange={(smartDisplayName) => onChange({ smartDisplayName })} />
            <TextField label="Management IP" name="smartManagementIp" value={values.smartManagementIp} placeholder="192.168.1.50" onChange={(smartManagementIp) => onChange({ smartManagementIp })} />
            <TextField label="MAC address" name="smartMacAddress" value={values.smartMacAddress} placeholder="00:11:22:33:44:55" className="sm:col-span-2" onChange={(smartMacAddress) => onChange({ smartMacAddress })} />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]">
              Outlet names
            </div>
            {outletPorts.length > 0 ? outletPorts.map((port) => (
              <TextField
                key={port.id}
                label={`Outlet ${String(port.slotNumber).padStart(2, '0')}`}
                ariaLabel={`Outlet ${port.slotNumber} custom name`}
                name={`smartOutlet-${port.id}`}
                value={namesByPortId.get(port.id) ?? ''}
                placeholder="Optional custom name"
                onChange={(name) => onChange({
                  smartOutletNames: [
                    ...values.smartOutletNames.filter((entry) => entry.portId !== port.id),
                    ...(name.trim() ? [{ portId: port.id, name }] : []),
                  ],
                })}
              />
            )) : (
              <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-sm font-medium text-[#75695d]">
                Add at least one outlet in Specs to name outlets.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-4 text-sm font-medium text-[#75695d]">
          This device is configured as a regular power strip.
        </div>
      )}
    </div>
  )
}
