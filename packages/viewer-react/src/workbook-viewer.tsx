import { useMemo, useRef } from 'react'

import type {
  DeepReadonly,
  SharedCanvasModel,
  SharedSystemsModel,
  SharedWorkbookModel,
} from '@homelab-inventory/viewer-model'

import { SharedCanvasViewer } from './canvas-viewer'
import type { ShareViewerIntent } from './index'
import { SharedInspector, type SharedViewerItem } from './share-inspector'
import { SharedSystemsViewer } from './systems-viewer'

export type SharedViewModel = DeepReadonly<SharedSystemsModel | SharedCanvasModel>

export interface SharedWorkbookViewerProps {
  model: DeepReadonly<SharedWorkbookModel>
  viewModels: Readonly<Record<string, SharedViewModel | undefined>>
  activeViewId?: string
  selectedItemId?: string | null
  selectedConnectionId?: string | null
  onIntent: (intent: ShareViewerIntent) => void
}

function modelItem(model: SharedViewModel | undefined, publicItemId: string | null | undefined): SharedViewerItem | null {
  if (!model || !publicItemId) return null
  if ('rows' in model) return model.rows.find((item) => item.publicItemId === publicItemId) ?? null
  return model.items.find((item) => item.publicItemId === publicItemId) ?? null
}

export function SharedWorkbookViewer({
  model,
  viewModels,
  activeViewId = model.initialViewPublicId,
  selectedItemId,
  selectedConnectionId,
  onIntent,
}: SharedWorkbookViewerProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeDescriptor = model.views.find((view) => view.publicViewId === activeViewId) ?? model.views[0]
  const activeModel = activeDescriptor ? viewModels[activeDescriptor.publicViewId] : undefined
  const selectedItem = useMemo(
    () => modelItem(activeModel, selectedItemId),
    [activeModel, selectedItemId],
  )

  const moveTabFocus = (index: number, direction: -1 | 1) => {
    const nextIndex = (index + direction + model.views.length) % model.views.length
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section className="hi-share-viewer" aria-label={model.title}>
      <header className="hi-share-viewer__header">
        <div>
          <span className="hi-share-viewer__eyebrow">{model.projectLabel}</span>
          <h1>{model.title}</h1>
          {model.description && <p>{model.description}</p>}
        </div>
      </header>

      <div className="hi-share-viewer__body" data-inspector-open={Boolean(selectedItem) || undefined}>
        <main className="hi-share-viewer__main">
          {!activeModel && (
            <div className="hi-share-viewer__empty" role="status">
              This shared view is not loaded.
            </div>
          )}
          {activeModel && 'rows' in activeModel && (
            <SharedSystemsViewer
              model={activeModel}
              selectedItemId={selectedItemId}
              onIntent={onIntent}
            />
          )}
          {activeModel && 'nodes' in activeModel && (
            <SharedCanvasViewer
              model={activeModel}
              selectedItemId={selectedItemId}
              selectedConnectionId={selectedConnectionId}
              onIntent={onIntent}
            />
          )}
        </main>
        {selectedItem && <SharedInspector item={selectedItem} onIntent={onIntent} />}
      </div>

      <nav className="hi-share-viewer__tabs" aria-label="Shared views">
        <div
          className="hi-share-viewer__tabs-scroll"
          role="tablist"
          data-mobile-overflow="horizontal"
        >
          {model.views.map((view, index) => {
            const active = view.publicViewId === activeDescriptor?.publicViewId
            return (
              <button
                key={view.publicViewId}
                ref={(element) => { tabRefs.current[index] = element }}
                className="hi-share-viewer__tab"
                type="button"
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                onClick={() => onIntent({ type: 'select-view', publicViewId: view.publicViewId })}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    moveTabFocus(index, 1)
                  } else if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    moveTabFocus(index, -1)
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onIntent({ type: 'select-view', publicViewId: view.publicViewId })
                  }
                }}
              >
                {view.name}
              </button>
            )
          })}
        </div>
      </nav>
    </section>
  )
}
