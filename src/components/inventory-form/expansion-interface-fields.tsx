import { TextField } from './field-primitives'
import type { ExpansionSlotGroupDraft } from './model'

export function ExpansionInterfaceFields({
  group,
  onChange,
}: {
  group: ExpansionSlotGroupDraft
  onChange: (patch: Partial<ExpansionSlotGroupDraft>) => void
}) {
  const family = group.interfaceFamily
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {family === 'm2-ae' || family === 'm2-bm' ? (
        <>
          <TextField label="Accepted keying" name={`expansion-group-${group.draftKey}-keying`} value={group.keying} placeholder="A+E" onChange={(keying) => onChange({ keying })} />
          <TextField label="Module size" name={`expansion-group-${group.draftKey}-module-size`} value={group.moduleSize} placeholder="2230" onChange={(moduleSize) => onChange({ moduleSize })} />
        </>
      ) : null}
      {family === 'usb' ? (
        <>
          <TextField label="USB generation" name={`expansion-group-${group.draftKey}-usb-generation`} value={group.usbGeneration} placeholder="USB 3.2 Gen 2" onChange={(usbGeneration) => onChange({ usbGeneration })} />
          <TextField label="Connector" name={`expansion-group-${group.draftKey}-connector`} value={group.connector} placeholder="USB-C" onChange={(connector) => onChange({ connector })} />
        </>
      ) : null}
      {family === 'ocp' ? <TextField label="OCP version" name={`expansion-group-${group.draftKey}-ocp-version`} value={group.ocpVersion} placeholder="3.0" onChange={(ocpVersion) => onChange({ ocpVersion })} /> : null}
      {family === 'mezzanine' || family === 'proprietary' || family === 'onboard' ? <TextField label="Interface key" name={`expansion-group-${group.draftKey}-interface-key`} value={group.interfaceKey} placeholder="Platform interface" onChange={(interfaceKey) => onChange({ interfaceKey })} /> : null}
    </div>
  )
}
