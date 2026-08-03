import { Checkbox } from '@/components/ui/checkbox'
import type { AccessRole } from '@/types/access'

export function RolePicker({
  roles,
  selected,
  onChange,
  disabled = false,
}: {
  roles: AccessRole[]
  selected: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-[#ded8ce] bg-[#fbf9f5] p-3 sm:grid-cols-2">
      {roles.filter((role) => role.active).map((role) => {
        const checked = selected.includes(role.id)
        return (
          <label key={role.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 hover:border-[#ded8ce] hover:bg-white">
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) => onChange(next === true
                ? [...selected, role.id].sort((a, b) => a - b)
                : selected.filter((id) => id !== role.id))}
              aria-label={`Assign ${role.name}`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-black text-[#20242c]">{role.name}</span>
              <span className="mt-0.5 block text-xs leading-4 text-[#756d62]">{role.description || 'Custom permission set'}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
