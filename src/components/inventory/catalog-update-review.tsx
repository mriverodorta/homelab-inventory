import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { loadCatalogUpdatePreview, loadCatalogUpdates, selectCatalogVariant } from '@/lib/registry-api'
import type { CatalogVariantUpdateSummary } from '@/types/registry'
import { RegistryUpdateChange } from './registry-update-change'

export function CatalogUpdateReview({
  onApply,
}: {
  onApply: (linkId: number) => Promise<void>
}) {
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariantUpdateSummary | null>(null)
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updates = useQuery({ queryKey: ['registry', 'updates'], queryFn: loadCatalogUpdates })
  const preview = useQuery({
    queryKey: ['registry', 'update-preview', selectedLinkId],
    queryFn: () => loadCatalogUpdatePreview(selectedLinkId!),
    enabled: selectedLinkId !== null,
  })

  async function apply() {
    if (selectedLinkId === null) return
    setPending(true)
    setError(null)
    try {
      await onApply(selectedLinkId)
      setSelectedLinkId(null)
      await updates.refetch()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Catalog update could not be applied.')
    } finally {
      setPending(false)
    }
  }

  async function chooseVariant() {
    if (!selectedVariant || !selectedTemplateKey) return
    setPending(true)
    setError(null)
    try {
      await selectCatalogVariant(selectedVariant.variantMatchId, selectedTemplateKey)
      setSelectedVariant(null)
      setSelectedTemplateKey(null)
      await updates.refetch()
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Catalog variant could not be selected.')
    } finally {
      setPending(false)
    }
  }

  const records = updates.data?.updates ?? []
  return (
    <>
      <div className="border-t border-[#e8e1d6] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-[#28231f]">Catalog updates</h3>
            <p className="mt-0.5 text-xs text-[#756d62]">Review catalog-owned changes before applying them. Local properties remain untouched.</p>
          </div>
          <span className="rounded-full bg-[#20242c] px-2 py-0.5 text-xs font-black text-white">{records.length}</span>
        </div>
        <div className="space-y-2">
          {updates.isLoading ? <p className="text-sm text-[#746b60]">Checking linked inventory…</p> : null}
          {!updates.isLoading && records.length === 0 ? <p className="text-sm text-[#746b60]">Linked inventory is up to date.</p> : null}
          {records.map((record) => (
            <div key={record.state === 'variant-selection-required' ? `variant-${record.variantMatchId}` : `link-${record.linkId}`} className="flex items-center justify-between gap-3 rounded-md border border-[#ded8ce] bg-white p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-[#28231f]">{record.itemName}</div>
                <div className="text-xs text-[#746b60]">
                  {record.state === 'variant-selection-required'
                    ? `${record.candidates.length} verified physical variants require selection`
                    : record.state === 'adoption-available'
                    ? `Local definition → Registry revision ${record.availableRevision}`
                    : `Revision ${record.importedRevision} → ${record.availableRevision}`}
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => {
                if (record.state === 'variant-selection-required') {
                  setSelectedVariant(record)
                  setSelectedTemplateKey(null)
                } else setSelectedLinkId(record.linkId)
              }}>Review</Button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={selectedLinkId !== null} onOpenChange={(open) => { if (!open && !pending) setSelectedLinkId(null) }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-[#fffdf8] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />Review catalog update</DialogTitle>
            <DialogDescription>Only verified catalog-owned fields shown below will change.</DialogDescription>
          </DialogHeader>
          {preview.isLoading ? <p className="py-8 text-center text-sm text-[#746b60]">Loading verified revision…</p> : null}
          {preview.data ? (
            <div className="space-y-3">
              <div className="rounded-md border border-[#ded8ce] bg-[#f7f2e9] p-3">
                <div className="font-black">{preview.data.itemName}</div>
                <div className="text-sm text-[#746b60]">
                  {preview.data.state === 'adoption-available'
                    ? `Local definition → Registry revision ${preview.data.availableRevision}`
                    : `Revision ${preview.data.importedRevision} → ${preview.data.availableRevision}`}
                </div>
              </div>
              {preview.data.changes.map((change) => (
                <RegistryUpdateChange key={change.path} change={change} />
              ))}
              {preview.data.dependencyConflicts.length > 0 ? (
                <div className="space-y-2 rounded-md border border-[#dfb3a5] bg-[#fff4ef] p-3 text-sm text-[#713325]">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="size-4" />
                    Resolve installed-component conflicts first
                  </div>
                  {preview.data.dependencyConflicts.flatMap((conflict) => conflict.findings.map((finding) => (
                    <p key={`${conflict.assignmentId}:${finding.code}`}>{finding.message}</p>
                  )))}
                </div>
              ) : null}
              <p className="text-xs text-[#746b60]">Preserved local fields: {preview.data.localFieldsPreserved.join(', ') || 'none'}.</p>
            </div>
          ) : null}
          {preview.isError ? <p className="text-sm font-semibold text-[#a33d31]">{preview.error instanceof Error ? preview.error.message : 'Update preview failed.'}</p> : null}
          {error ? <p className="text-sm font-semibold text-[#a33d31]" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setSelectedLinkId(null)}>Later</Button>
            <Button type="button" disabled={pending || !preview.data || preview.data.dependencyConflicts.length > 0} onClick={() => void apply()}><RefreshCw className="size-4" />{pending ? 'Applying…' : 'Apply update'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedVariant !== null} onOpenChange={(open) => {
        if (!open && !pending) {
          setSelectedVariant(null)
          setSelectedTemplateKey(null)
          setError(null)
        }
      }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-[#fffdf8] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Select the physical hardware variant</DialogTitle>
            <DialogDescription>The model family matches multiple verified layouts. Choose the motherboard or topology that matches this device; installed components are not used to guess.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {selectedVariant?.candidates.map((candidate) => (
              <button
                key={candidate.templateKey}
                type="button"
                aria-pressed={selectedTemplateKey === candidate.templateKey}
                className={`grid gap-1 rounded-md border p-3 text-left transition-colors ${selectedTemplateKey === candidate.templateKey ? 'border-[#3c746a] bg-[#e7f1ed]' : 'border-[#ded8ce] bg-white hover:bg-[#f7f2e9]'}`}
                onClick={() => setSelectedTemplateKey(candidate.templateKey)}
              >
                <span className="text-sm font-black text-[#28231f]">{candidate.label}</span>
                {candidate.structuralSummary ? <span className="text-xs leading-5 text-[#746b60]">{candidate.structuralSummary}</span> : null}
                <span className="text-[11px] text-[#8a8177]">Revision {candidate.revision}</span>
              </button>
            ))}
          </div>
          {error ? <p className="text-sm font-semibold text-[#a33d31]" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setSelectedVariant(null)}>Later</Button>
            <Button type="button" disabled={pending || !selectedTemplateKey} onClick={() => void chooseVariant()}>{pending ? 'Selecting…' : 'Continue to review'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
