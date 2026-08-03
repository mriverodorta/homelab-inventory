import type { ComponentType } from 'react'
import {
  BatteryCharging,
  Boxes,
  Cable,
  CircuitBoard,
  Cpu,
  Database,
  EthernetPort,
  Fan,
  HardDrive,
  MemoryStick,
  Monitor,
  Network,
  PanelsTopLeft,
  PlugZap,
  Server,
  Speaker,
  Wifi,
  Zap,
} from 'lucide-react'
import type { CatalogFacetCategory } from '@/types/registry'

const CATEGORY_ICONS: Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  server: Server,
  desktop: Monitor,
  workstation: PanelsTopLeft,
  pcBuild: Boxes,
  nas: Database,
  cpu: Cpu,
  ram: MemoryStick,
  storage: HardDrive,
  gpu: CircuitBoard,
  network: EthernetPort,
  wireless: Wifi,
  motherboard: PanelsTopLeft,
  cpuCooler: Fan,
  case: Boxes,
  powerSupply: Zap,
  powerAdapter: PlugZap,
  soundCard: Speaker,
  switch: Network,
  patchPanel: Cable,
  monitor: Monitor,
  ups: BatteryCharging,
  powerStrip: PlugZap,
}

export function CatalogCategoryPicker({
  categories,
  onSelect,
}: {
  categories: CatalogFacetCategory[]
  onSelect: (category: CatalogFacetCategory) => void
}) {
  return (
    <section className="flex min-h-0 flex-1 overflow-y-auto p-5" aria-labelledby="catalog-category-heading">
      <div className="mx-auto w-full max-w-5xl self-start">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase text-[#746b60]">Official catalog</p>
          <h3 id="catalog-category-heading" className="mt-2 text-2xl font-black text-[#20242c]">What hardware are you adding?</h3>
          <p className="mt-2 text-sm leading-6 text-[#746b60]">
            Choose a category to load its available filters and verified hardware definitions.
          </p>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((category) => {
            const Icon = CATEGORY_ICONS[category.type] ?? Boxes
            return (
              <button
                key={category.type}
                type="button"
                onClick={() => onSelect(category)}
                className="group flex min-h-24 items-center gap-3 rounded-md border border-[#ded8ce] bg-white p-4 text-left transition-colors hover:border-[#74968e] hover:bg-[#edf5f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#74968e]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-white transition-colors group-hover:bg-[#315f56]">
                  <Icon className="size-5" aria-hidden={true} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-[#20242c]">{category.label}</span>
                  <span className="mt-1 block text-xs text-[#746b60]">{category.count.toLocaleString()} verified</span>
                </span>
              </button>
            )
          })}
        </div>
        {categories.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-[#cfc6ba] bg-[#f7f2e9] p-5 text-sm leading-6 text-[#746b60]">
            No verified hardware categories are available in this catalog revision.
          </div>
        ) : null}
      </div>
    </section>
  )
}
