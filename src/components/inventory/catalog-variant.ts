import type { CatalogSearchItem, CatalogVariantEvidence } from '@/types/registry'

export function catalogVariantLabel(evidence?: CatalogVariantEvidence): string | null {
  if (!evidence || evidence.source === 'generic') return null
  if (evidence.label) return evidence.label

  const board = [evidence.motherboardPartNumber, evidence.motherboardRevision]
    .filter(Boolean)
    .join(' ')
  if (board && evidence.structuralSummary) return `Board ${board} · ${evidence.structuralSummary}`
  if (board) return `Board ${board}`
  return evidence.structuralSummary ?? null
}

export function catalogVariantDescription(template: CatalogSearchItem): string {
  return catalogVariantLabel(template.variantEvidence)
    ?? [template.manufacturer, template.type].filter(Boolean).join(' · ')
}
