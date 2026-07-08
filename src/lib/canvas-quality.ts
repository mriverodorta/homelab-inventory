import type { ComponentType, InventoryItem } from '@/types/inventory'

const CPU_ROW_TONES = [
  'bg-[#c8e7ee] text-[#132b31]',
  'bg-[#aed8e2] text-[#132b31]',
  'bg-[#95c8d5] text-[#102b33]',
  'bg-[#78b4c3] text-[#102b33]',
  'bg-[#5d9dad] text-[#0e252c]',
  'bg-[#3f7f91] text-[#f4fbfd]',
  'bg-[#286375] text-[#f4fbfd]',
]

const RAM_ROW_TONES = [
  'bg-[#f3dd9b] text-[#2b2010]',
  'bg-[#ddb668] text-[#2b2010]',
  'bg-[#b88935] text-[#fff8e6]',
  'bg-[#8d6420] text-[#fff8e6]',
]

const STORAGE_ROW_TONES = [
  'bg-[#eee5d4] text-[#3d3429]',
  'bg-[#e2d3ba] text-[#3d3429]',
  'bg-[#d3bd96] text-[#3d3429]',
  'bg-[#c2a374] text-[#332717]',
  'bg-[#a8824e] text-[#fff8e8]',
  'bg-[#76532e] text-[#fff8e8]',
]

export function getCpuGeneration(item: InventoryItem): number | null {
  const number = item.number ?? item.name
  const intelCoreMatch = number.match(/i[3579]-(\d{4,5})/i)

  if (intelCoreMatch) {
    const modelNumber = intelCoreMatch[1]

    return Number(modelNumber.length >= 5 ? modelNumber.slice(0, 2) : modelNumber.slice(0, 1))
  }

  const ryzenMatch = number.match(/^(\d)\\d{3}/)

  if (item.manufacturer?.toLowerCase() === 'amd' && ryzenMatch) {
    const ryzenSeries = Number(ryzenMatch[1])

    if (ryzenSeries >= 4) {
      return 10
    }
  }

  return null
}

function toneByRange(value: number, min: number, max: number, tones: string[]): string {
  if (value <= min) {
    return tones[0]
  }

  if (value >= max) {
    return tones[tones.length - 1]
  }

  const ratio = (value - min) / (max - min)
  const index = Math.round(ratio * (tones.length - 1))

  return tones[index]
}

export function getCpuQualityTone(item: InventoryItem): string {
  const generation = getCpuGeneration(item) ?? 7

  return toneByRange(generation, 7, 13, CPU_ROW_TONES)
}

export function getRamQualityTone(item: InventoryItem): string {
  const capacityGb = typeof item.specs?.capacityGb === 'number' ? item.specs.capacityGb : 16

  return toneByRange(capacityGb, 16, 64, RAM_ROW_TONES)
}

export function getStorageCapacityGb(item: InventoryItem): number {
  if (typeof item.specs?.capacityTb === 'number') {
    return item.specs.capacityTb * 1024
  }

  if (typeof item.specs?.capacityGb === 'number') {
    return item.specs.capacityGb
  }

  return 0
}

export function getStorageQualityTone(item: InventoryItem): string {
  const capacityGb = getStorageCapacityGb(item)

  if (capacityGb <= 256) {
    return STORAGE_ROW_TONES[0]
  }

  if (capacityGb <= 512) {
    return STORAGE_ROW_TONES[1]
  }

  if (capacityGb <= 1024) {
    return STORAGE_ROW_TONES[2]
  }

  if (capacityGb <= 2048) {
    return STORAGE_ROW_TONES[3]
  }

  if (capacityGb <= 4096) {
    return STORAGE_ROW_TONES[4]
  }

  return STORAGE_ROW_TONES[5]
}

export function getCanvasAssignmentTone(type: ComponentType, item: InventoryItem): string {
  if (type === 'cpu') {
    return getCpuQualityTone(item)
  }

  if (type === 'ram') {
    return getRamQualityTone(item)
  }

  if (type === 'storage') {
    return getStorageQualityTone(item)
  }

  if (type === 'gpu') {
    return 'bg-[#d57b69] text-[#2f1813]'
  }

  return 'bg-[#86a989] text-[#132117]'
}
