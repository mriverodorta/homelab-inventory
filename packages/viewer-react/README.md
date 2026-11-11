# @homelab-inventory/viewer-react

Reusable read-only React components for Homelab Inventory Systems, Canvas, workbook tabs, and Inspector views.

## API

- `SharedWorkbookViewer`
- `SharedSystemsViewer`
- `SharedCanvasViewer`
- `SharedInspector`
- `ShareViewerIntent`

Import `@homelab-inventory/viewer-react/viewer.css` once in the consuming application. Styles are scoped beneath `.hi-share-viewer`.

The Canvas uses XYFlow only for pan, zoom, fit, centering, and selection. It does not include drag and drop, editing, route calculation, workers, persistence, API clients, or authentication.

## Versioning

Version 0.1.2 raises the React Flow dependency floor to 12.12.1 for reviewed
selection and observer cleanup fixes. The viewer contract and viewer-model
0.1.1 dependency are unchanged; existing shares do not need republishing.

Version 0.1.1 displays the shared model's physical computer labels consistently in systems, canvas and Inspector, including server-rendered previews. Pass verified exact Registry presentation context to viewer-model constructors; the React package performs no Registry fetches and uses the shared model's single label implementation. Existing signed shares do not need republishing.

Package versions follow independent SemVer. Private service consumers should pin exact package versions so a deployed renderer remains reproducible for the share contracts it advertises.
