import type { DeepReadonly, SharedSystemsModel } from '@homelab-inventory/viewer-model'

import type { ShareViewerIntent } from './index'

export interface SharedSystemsViewerProps {
  model: DeepReadonly<SharedSystemsModel>
  selectedItemId?: string | null
  onIntent: (intent: ShareViewerIntent) => void
}

export function SharedSystemsViewer({ model, selectedItemId, onIntent }: SharedSystemsViewerProps) {
  return (
    <div className="hi-share-viewer__systems-scroll" tabIndex={0}>
      <table className="hi-share-viewer__systems-table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Name</th>
            <th scope="col">Manufacturer</th>
            <th scope="col">Model</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((item) => {
            const selected = selectedItemId === item.publicItemId
            return (
              <tr key={item.publicItemId} data-selected={selected || undefined}>
                <td className="hi-share-viewer__system-type">{item.type}</td>
                <td>
                  <button
                    className="hi-share-viewer__row-button"
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onIntent({
                      type: 'select-item',
                      publicViewId: model.publicViewId,
                      publicItemId: item.publicItemId,
                    })}
                  >
                    {item.name}
                  </button>
                </td>
                <td>{item.manufacturer ?? 'Not recorded'}</td>
                <td>{item.model ?? 'Not recorded'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
