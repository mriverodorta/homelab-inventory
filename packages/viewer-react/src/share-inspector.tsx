import { useEffect } from 'react'
import { X } from 'lucide-react'

import type { DeepReadonly, SharedSystemsModel } from '@homelab-inventory/viewer-model'

import type { ShareViewerIntent } from './index'

export type SharedViewerItem = DeepReadonly<SharedSystemsModel['rows'][number]>

export interface SharedInspectorProps {
  item: SharedViewerItem
  onIntent: (intent: ShareViewerIntent) => void
}

export function SharedInspector({ item, onIntent }: SharedInspectorProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onIntent({ type: 'clear-selection' })
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onIntent])

  return (
    <aside className="hi-share-viewer__inspector" aria-label={`${item.name} details`}>
      <header className="hi-share-viewer__inspector-header">
        <div>
          <span className="hi-share-viewer__eyebrow">{item.type}</span>
          <h2>{item.name}</h2>
        </div>
        <button
          className="hi-share-viewer__icon-button"
          type="button"
          aria-label="Close details"
          title="Close details"
          onClick={() => onIntent({ type: 'clear-selection' })}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <dl className="hi-share-viewer__details">
        <div><dt>Manufacturer</dt><dd>{item.manufacturer ?? 'Not recorded'}</dd></div>
        <div><dt>Model</dt><dd>{item.model ?? 'Not recorded'}</dd></div>
        <div><dt>Source</dt><dd>{item.source.type === 'registry' ? 'Registry' : 'Custom'}</dd></div>
      </dl>

      {item.ports.length > 0 && (
        <section className="hi-share-viewer__inspector-section">
          <h3>Ports</h3>
          <ul className="hi-share-viewer__plain-list">
            {item.ports.map((port) => (
              <li key={port.publicPortId}>
                <span>{port.name}</span>
                <span>{port.connector ?? port.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(item.tags?.length ?? 0) > 0 && (
        <section className="hi-share-viewer__inspector-section">
          <h3>Tags</h3>
          <div className="hi-share-viewer__tags">
            {item.tags?.map((tag) => <span key={tag.publicTagId}>{tag.name}</span>)}
          </div>
        </section>
      )}

      {(item.customFields?.length ?? 0) > 0 && (
        <section className="hi-share-viewer__inspector-section">
          <h3>Details</h3>
          <dl className="hi-share-viewer__details">
            {item.customFields?.map((field) => (
              <div key={field.publicFieldId}><dt>{field.name}</dt><dd>{String(field.value)}</dd></div>
            ))}
          </dl>
        </section>
      )}
    </aside>
  )
}
