import type { InventoryMetadataColorToken, InventoryMetadataFieldType } from '@/types/inventory-metadata'

export const FIELD_TYPE_LABELS: Readonly<Record<InventoryMetadataFieldType, string>> = {
  shortText: 'Short text', longText: 'Long text', number: 'Number', boolean: 'Yes / No',
  date: 'Date', dateTime: 'Date and time', singleSelect: 'Single select', multiSelect: 'Multiple select', url: 'URL',
}

export const COLOR_STYLES: Readonly<Record<InventoryMetadataColorToken, string>> = {
  gray: 'bg-neutral-500', red: 'bg-red-600', orange: 'bg-orange-500', amber: 'bg-amber-500',
  yellow: 'bg-yellow-400', green: 'bg-emerald-600', teal: 'bg-teal-600', blue: 'bg-blue-600',
  indigo: 'bg-indigo-600', purple: 'bg-purple-600', pink: 'bg-pink-600',
}
