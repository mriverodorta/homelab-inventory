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

Package versions follow independent SemVer. Private service consumers should pin exact package versions so a deployed renderer remains reproducible for the share contracts it advertises.
