import { describe, expect, it } from 'vitest'
import {
  getCanvasAssignmentTone,
  getCpuGeneration,
  getStorageCapacityGb,
} from '@/lib/canvas-quality'
import type { InventoryItem } from '@/types/inventory'

describe('canvas quality colors', () => {
  it('extracts Intel Core generations from CPU numbers', () => {
    expect(getCpuGeneration(cpu('i7-7700'))).toBe(7)
    expect(getCpuGeneration(cpu('i5-10500T'))).toBe(10)
    expect(getCpuGeneration(cpu('i7-13700T'))).toBe(13)
  })

  it('keeps newer CPU generations visually darker than older ones', () => {
    const oldTone = getCanvasAssignmentTone('cpu', cpu('i7-7700'))
    const newTone = getCanvasAssignmentTone('cpu', cpu('i7-13700T'))

    expect(oldTone).not.toBe(newTone)
    expect(oldTone).toContain('bg-[#c8e7ee]')
    expect(newTone).toContain('bg-[#286375]')
  })

  it('darkens RAM rows as module capacity increases', () => {
    const smallTone = getCanvasAssignmentTone('ram', ram(16))
    const largeTone = getCanvasAssignmentTone('ram', ram(64))

    expect(smallTone).not.toBe(largeTone)
    expect(smallTone).toContain('bg-[#f3dd9b]')
    expect(largeTone).toContain('bg-[#8d6420]')
  })

  it('normalizes storage capacity to GB and darkens larger storage', () => {
    const smallStorage = storageGb(256)
    const largeStorage = storageTb(4)

    expect(getStorageCapacityGb(largeStorage)).toBe(4096)
    expect(getCanvasAssignmentTone('storage', smallStorage)).toContain('bg-[#eee5d4]')
    expect(getCanvasAssignmentTone('storage', largeStorage)).toContain('bg-[#a8824e]')
  })
})

function cpu(number: string): InventoryItem {
  return {
    id: Number(number.match(/\d+/)?.[0] ?? 1),
    name: number,
    type: 'cpu',
    manufacturer: 'Intel',
    number,
  }
}

function ram(capacityGb: number): InventoryItem {
  return {
    id: capacityGb,
    name: `${capacityGb}GB`,
    type: 'ram',
    specs: { capacityGb },
  }
}

function storageGb(capacityGb: number): InventoryItem {
  return {
    id: capacityGb,
    name: `${capacityGb}GB`,
    type: 'storage',
    specs: { capacityGb },
  }
}

function storageTb(capacityTb: number): InventoryItem {
  return {
    id: capacityTb * 1024,
    name: `${capacityTb}TB`,
    type: 'storage',
    specs: { capacityTb },
  }
}
