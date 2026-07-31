import type { ComponentType } from '@/types/inventory'

export function slotTone(type: ComponentType): string {
  const tones: Partial<Record<ComponentType, string>> = {
    cpu: 'border-[#b8d4dc] bg-[#d7eef2]',
    gpu: 'border-[#dfb3a5] bg-[#fff4ee]',
    network: 'border-[#a7d8cd] bg-[#d3eee7]',
    ram: 'border-[#e8d392] bg-[#fff2c7]',
    storage: 'border-[#d6ccbd] bg-[#f3ead8]',
  }

  return tones[type] ?? 'border-[#e5dccf] bg-[#f3f0ea]'
}
