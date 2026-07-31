import { ArrowLeftRight, ArrowUpDown, PlugZap } from 'lucide-react'
import { updatePort } from '@/components/inspector/connections/endpoint-state'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  PATCH_PANEL_ROW_ORDER_PROPERTY,
  getPatchPanelRowOrderValue,
  getSwappedPatchPanelRowOrderValue,
} from '@/lib/patch-panel'
import {
  POWER_EQUIPMENT_ORIENTATION_PROPERTY,
  UPS_OUTLET_GROUP_ORDER_PROPERTY,
  getPowerEquipmentOrientation,
  getSwappedUpsOutletGroupOrder,
  getUpsOutletGroupOrder,
  type PowerEquipmentOrientation,
} from '@/lib/power-equipment-layout'
import { cn } from '@/lib/utils'
import type {
  InventoryItem,
  InventoryPort,
  InventoryProperties,
} from '@/types/inventory'

const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'

export function PatchPanelLabelGrid({
  item,
  onUpdate,
}: {
  item: InventoryItem
  onUpdate: (ports: InventoryPort[]) => void
}) {
  const ports = item.ports ?? []

  if (item.type !== 'patchPanel' || ports.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Keystone Labels"
      icon={PlugZap}
      badge={<StatusBadge>{ports.length}</StatusBadge>}
    >
      <div className="grid grid-cols-2 gap-2">
        {ports
          .slice()
          .sort((first, second) => first.slotNumber - second.slotNumber)
          .map((port) => (
            <label
              key={port.id}
              className="grid grid-cols-[2rem_1fr] items-center gap-1.5 rounded-md border border-[#e5dccf] bg-[#fffdf8] p-1.5 text-xs font-bold text-[#75695d]"
            >
              <span className="text-center text-[11px] text-[#20242c]">
                {String(port.slotNumber).padStart(2, '0')}
              </span>
              <Input
                value={port.label ?? ''}
                placeholder="Label"
                className="h-7 text-xs"
                aria-label={`Keystone ${port.slotNumber} label`}
                onChange={(event) => {
                  onUpdate(updatePort(ports, port.id, { label: event.target.value }))
                }}
              />
            </label>
          ))}
      </div>
    </InspectorSection>
  )
}

export function PatchPanelRowDisplayControls({
  item,
  onUpdateProperties,
}: {
  item: InventoryItem
  onUpdateProperties: (properties: InventoryProperties) => void
}) {
  if (item.type !== 'patchPanel') {
    return null
  }

  const rowOrder = getPatchPanelRowOrderValue(item)
  const currentOrder = rowOrder === 'front-back'
    ? 'Front row on top, back row on bottom'
    : 'Back row on top, front row on bottom'

  return (
    <InspectorSection
      title="Row Display"
      icon={ArrowUpDown}
      badge={<StatusBadge>{rowOrder === 'front-back' ? 'Front top' : 'Back top'}</StatusBadge>}
    >
      <div className="grid gap-3">
        <div className="rounded-md border border-[#eee6db] bg-[#f8f3eb] p-3">
          <div className={cn(labelClass, 'text-[9px]')}>Current layout</div>
          <div className="mt-1 text-sm font-black text-[#20242c]">{currentOrder}</div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 justify-center gap-2"
          onClick={() => {
            onUpdateProperties({
              [PATCH_PANEL_ROW_ORDER_PROPERTY]: getSwappedPatchPanelRowOrderValue(item),
            })
          }}
        >
          <ArrowUpDown className="size-4" />
          Swap Rows
        </Button>
      </div>
    </InspectorSection>
  )
}

export function PowerEquipmentLayoutControls({
  item,
  disabled = false,
  onUpdateProperties,
}: {
  item: InventoryItem
  disabled?: boolean
  onUpdateProperties: (properties: InventoryProperties) => void
}) {
  if (item.type !== 'ups' && item.type !== 'powerStrip') {
    return null
  }

  const orientation = getPowerEquipmentOrientation(item)
  const vertical = orientation === 'vertical'
  const order = item.type === 'ups' ? getUpsOutletGroupOrder(item) : null
  const orderDescription = order === 'surge-battery'
    ? (vertical ? 'Surge left, battery right' : 'Surge top, battery bottom')
    : (vertical ? 'Battery left, surge right' : 'Battery top, surge bottom')
  const setOrientation = (next: PowerEquipmentOrientation) => {
    onUpdateProperties({ [POWER_EQUIPMENT_ORIENTATION_PROPERTY]: next })
  }
  const itemKey = runtimeItemKey(item).replace(/[^a-zA-Z0-9_-]/g, '-')
  const radioGroupName = `power-equipment-orientation-${itemKey}`
  const orientationLegendId = `${radioGroupName}-legend`

  return (
    <InspectorSection title="Canvas Layout" icon={vertical ? ArrowLeftRight : ArrowUpDown}>
      <div className="grid gap-4">
        <fieldset role="radiogroup" aria-labelledby={orientationLegendId}>
          <legend id={orientationLegendId} className={cn(labelClass, 'mb-2 text-[9px]')}>
            Orientation
          </legend>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[#e5dccf] bg-[#f8f3eb] p-1">
            {(['horizontal', 'vertical'] as const).map((value) => {
              const inputId = `${radioGroupName}-${value}`

              return (
                <div key={value} className="relative">
                  <input
                    id={inputId}
                    type="radio"
                    name={radioGroupName}
                    value={value}
                    checked={orientation === value}
                    disabled={disabled}
                    className="peer sr-only"
                    onChange={() => setOrientation(value)}
                  />
                  <label
                    htmlFor={inputId}
                    className="flex h-11 cursor-pointer items-center justify-center rounded-sm text-sm font-semibold text-[#75695d] transition-colors peer-checked:bg-[#20242c] peer-checked:text-[#fffdf8] peer-focus-visible:ring-2 peer-focus-visible:ring-[#ddb668] peer-focus-visible:ring-offset-1 peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
                  >
                    {value === 'horizontal' ? 'Horizontal' : 'Vertical'}
                  </label>
                </div>
              )
            })}
          </div>
        </fieldset>

        {item.type === 'ups' ? (
          <div className="grid gap-3">
            <div className="rounded-md border border-[#eee6db] bg-[#f8f3eb] p-3">
              <div className={cn(labelClass, 'text-[9px]')}>Outlet group order</div>
              <div className="mt-1 text-sm font-black text-[#20242c]">{orderDescription}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 justify-center gap-2"
              disabled={disabled}
              onClick={() => onUpdateProperties({
                [UPS_OUTLET_GROUP_ORDER_PROPERTY]: getSwappedUpsOutletGroupOrder(item),
              })}
            >
              {vertical ? <ArrowLeftRight className="size-4" /> : <ArrowUpDown className="size-4" />}
              {vertical ? 'Swap Columns' : 'Swap Rows'}
            </Button>
          </div>
        ) : null}
      </div>
    </InspectorSection>
  )
}
