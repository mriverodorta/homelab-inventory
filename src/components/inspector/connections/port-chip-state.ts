import type { ConnectionState } from '@/components/inspector/connections/endpoint-state'

export function portChipClass(state: ConnectionState): string {
  if (state === 'connected') {
    return 'border-[#a7d8cd] bg-[#d3eee7] text-[#143733]'
  }

  if (state === 'partial') {
    return 'border-[#e8d392] bg-[#fff2c7] text-[#3d2a08]'
  }

  if (state === 'conflict') {
    return 'border-[#dfb3a5] bg-[#fff4ee] text-[#7a2c1d]'
  }

  return 'border-[#e5dccf] bg-[#f3f0ea] text-[#3c342b]'
}
