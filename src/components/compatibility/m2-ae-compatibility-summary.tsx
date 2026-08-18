import { CircleCheck, CircleHelp, Info } from 'lucide-react'
import { moduleKeyFitsSocket } from '../../../packages/catalog-protocol/src/m2-ae-compatibility'
import type { OptionalModuleSlotGroup, RequiredHostBus } from '@/types/compatibility'

type M2AeRequirements = {
  key?: string
  moduleSize?: string
  requiredBuses?: RequiredHostBus[]
}

function busLabel(bus: RequiredHostBus): string {
  if (bus.family === 'pcie') {
    return [
      'PCIe',
      bus.minimumLanes ? `x${bus.minimumLanes} minimum` : null,
      bus.minimumPcieGeneration ? `Gen${bus.minimumPcieGeneration} minimum` : null,
    ].filter(Boolean).join(' · ')
  }
  return bus.minimumUsbGeneration ? `${bus.minimumUsbGeneration} minimum` : 'USB'
}

function physicalFit(resource: OptionalModuleSlotGroup, requirements: M2AeRequirements): {
  confirmed: boolean
  value: string
} {
  const keyConfirmed = !requirements.key
    || (resource.socketKeys?.some((socketKey) => moduleKeyFitsSocket(requirements.key, socketKey)) ?? false)
  const sizeConfirmed = !requirements.moduleSize
    || resource.moduleSizes?.some((size) => size.toLowerCase() === requirements.moduleSize?.toLowerCase()) === true
  const socket = resource.socketKeys?.length ? `${resource.socketKeys.join('/')} key socket` : 'Socket key not recorded'
  const size = requirements.moduleSize ? `${requirements.moduleSize} module` : 'Module size not recorded'
  return { confirmed: keyConfirmed && sizeConfirmed, value: `${socket} · ${size}` }
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'confirmed' | 'unknown' | 'neutral'
}) {
  const Icon = tone === 'confirmed' ? CircleCheck : tone === 'unknown' ? CircleHelp : Info
  return (
    <div className="grid min-w-0 gap-1 border-b border-[#eee6da] py-2.5 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-bold text-[#75695d]">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2 text-sm font-bold text-[#302a25]">
        <Icon
          aria-hidden="true"
          className={tone === 'confirmed'
            ? 'mt-0.5 size-4 shrink-0 text-emerald-700'
            : 'mt-0.5 size-4 shrink-0 text-[#8a8177]'}
        />
        <span className="min-w-0 break-words">{value}</span>
      </dd>
    </div>
  )
}

export function M2AeCompatibilitySummary({
  resource,
  requirements,
}: {
  resource: OptionalModuleSlotGroup
  requirements: M2AeRequirements
}) {
  const fit = physicalFit(resource, requirements)
  const requiredBuses = requirements.requiredBuses?.map(busLabel).join(' + ')
  const busEvidence = Object.hasOwn(resource, 'availableBuses')
    ? resource.availableBuses?.length
      ? resource.availableBuses.map((bus) => (
          bus.family === 'pcie'
            ? ['PCIe', bus.lanes ? `x${bus.lanes}` : null, bus.pcieGeneration ? `Gen${bus.pcieGeneration}` : null]
                .filter(Boolean).join(' ')
            : bus.usbGeneration ?? 'USB'
        )).join(' + ')
      : 'Verified: no supported bus is exposed'
    : 'Host bus evidence is not recorded'
  const intendedUse = resource.intendedModuleKinds?.length
    ? `${resource.intendedModuleKinds.join(', ')} (descriptive only)`
    : 'No OEM intended use is recorded'

  return (
    <section aria-labelledby="m2-ae-compatibility-heading" className="border-t border-[#e5dccf] pt-4">
      <h3 id="m2-ae-compatibility-heading" className="mb-1 text-sm font-extrabold text-[#302a25]">
        M.2 A/E compatibility
      </h3>
      <dl className="px-0.5">
        <SummaryRow label="Physical fit" value={fit.value} tone={fit.confirmed ? 'confirmed' : 'unknown'} />
        <SummaryRow
          label="Required buses"
          value={requiredBuses ? `${requiredBuses} · ${busEvidence}` : `No bus requirement declared · ${busEvidence}`}
          tone={requiredBuses && Object.hasOwn(resource, 'availableBuses') ? 'confirmed' : 'unknown'}
        />
        <SummaryRow label="OEM intended use" value={intendedUse} tone="neutral" />
      </dl>
    </section>
  )
}
