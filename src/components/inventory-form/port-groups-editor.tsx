import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  isSupportedSwitchPortSpeed,
  isSwitchNetworkPortType,
  SWITCH_NETWORK_PORT_SPEEDS,
} from '@/lib/switch-ports'
import type { InventoryPortRole, InventoryPortType, InventoryType } from '@/types/inventory'
import { FieldError } from './field-primitives'
import { inventoryTypeHasPorts, type PortGroup, updatePortGroupForType } from './model'
import { fieldClassName, formatPortTypeLabel, PORT_ROLES, PORT_SPEEDS, PORT_TYPES } from './options'

function PortCountInput({
  groupIndex,
  value,
  onChange,
}: {
  groupIndex: number
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  return (
    <Input
      aria-label={`Port group ${groupIndex + 1} count`}
      type="number"
      min={1}
      value={draft}
      className={fieldClassName()}
      onBlur={() => {
        if (draft === '') setDraft(String(value))
      }}
      onChange={(event) => {
        const nextDraft = event.target.value
        setDraft(nextDraft)
        if (nextDraft === '') return

        const nextValue = Number(nextDraft)
        if (Number.isFinite(nextValue) && nextValue >= 1) {
          onChange(nextValue)
        }
      }}
    />
  )
}

export function PortGroupsEditor({
  type,
  groups,
  error,
  onChange,
  onSelectOpenChange,
}: {
  type: InventoryType
  groups: PortGroup[]
  error?: string
  onChange: (groups: PortGroup[]) => void
  onSelectOpenChange?: (open: boolean) => void
}) {
  if (!inventoryTypeHasPorts(type)) return null
  const showsRole = type === 'switch' || type === 'network'

  function updateGroup(id: number, update: Partial<PortGroup>) {
    onChange(groups.map((group) => (
      group.id === id ? updatePortGroupForType(type, group, update) : group
    )))
  }

  function addGroup() {
    const nextId = groups.reduce((highest, group) => Math.max(highest, group.id), 0) + 1
    onChange([
      ...groups,
      {
        id: nextId,
        count: 1,
        type: type === 'gpu' ? 'displayport' : 'rj45',
        speed: type === 'gpu' || type === 'patchPanel' ? '' : '1G',
        role: 'access',
      },
    ])
  }

  return (
    <section className="rounded-md border border-[#ded8ce] bg-[#fffdf8] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-[#20242c]">Ports</h3>
          <p className="text-xs text-[#75695d]">Add one group per physical port type or speed.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>
          <Plus className="size-3" />
          Group
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {groups.map((group, index) => {
          const requiresSpeed = type === 'switch' && isSwitchNetworkPortType(group.type)
          const hasValidSpeed = isSupportedSwitchPortSpeed(group.speed)
          const speedOptions = requiresSpeed ? SWITCH_NETWORK_PORT_SPEEDS : PORT_SPEEDS

          return (
            <div key={group.id} className={`grid grid-cols-2 gap-2 ${showsRole ? 'sm:grid-cols-[72px_1fr_1fr_1fr_auto]' : 'sm:grid-cols-[72px_1fr_1fr_auto]'}`}>
              <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#75695d]">
                Count
                <PortCountInput
                  groupIndex={index}
                  value={group.count}
                  onChange={(count) => updateGroup(group.id, { count })}
                />
              </label>
              <div className="grid gap-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#75695d]">
                <span>Type</span>
                <Select value={group.type} onValueChange={(value) => updateGroup(group.id, { type: value as InventoryPortType })} onOpenChange={onSelectOpenChange}>
                  <SelectTrigger className={fieldClassName()} aria-label={`Port group ${index + 1} type`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PORT_TYPES.map((portType) => <SelectItem key={portType} value={portType}>{formatPortTypeLabel(portType)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#75695d]">
                <span>Speed</span>
                <Select value={requiresSpeed && !hasValidSpeed ? 'required' : group.speed || 'none'} onValueChange={(value) => updateGroup(group.id, { speed: value === 'none' ? '' : value })} onOpenChange={onSelectOpenChange}>
                  <SelectTrigger className={fieldClassName()} aria-label={`Port group ${index + 1} speed`}><SelectValue placeholder="Select speed" /></SelectTrigger>
                  <SelectContent>
                    {requiresSpeed && !hasValidSpeed ? <SelectItem value="required" disabled>Select speed</SelectItem> : null}
                    {speedOptions.map((speed) => <SelectItem key={speed || 'none'} value={speed || 'none'}>{speed || 'No speed'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {showsRole ? (
                <div className="grid gap-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#75695d]">
                  <span>Role</span>
                  <Select value={group.role} onValueChange={(value) => updateGroup(group.id, { role: value as InventoryPortRole })} onOpenChange={onSelectOpenChange}>
                    <SelectTrigger className={fieldClassName()} aria-label={`Port group ${index + 1} role`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PORT_ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <Button type="button" variant="ghost" size="icon" className="self-end" onClick={() => onChange(groups.filter((candidate) => candidate.id !== group.id))} aria-label={`Remove port group ${index + 1}`}>
                <Trash2 className="size-4" />
              </Button>
              {requiresSpeed && !hasValidSpeed ? <div role="alert" className={`col-span-2 text-xs font-semibold text-[#8b3322] ${showsRole ? 'sm:col-span-5' : 'sm:col-span-4'}`}>Select a supported speed for this {formatPortTypeLabel(group.type)} switch port group.</div> : null}
            </div>
          )
        })}
      </div>
      <FieldError message={error} />
    </section>
  )
}
