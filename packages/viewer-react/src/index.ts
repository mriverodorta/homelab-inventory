export {
  SharedCanvasViewer,
  type SharedCanvasViewerProps,
} from './canvas-viewer'
export {
  SharedInspector,
  type SharedInspectorProps,
  type SharedViewerItem,
} from './share-inspector'
export {
  SharedSystemsViewer,
  type SharedSystemsViewerProps,
} from './systems-viewer'
export {
  SharedWorkbookViewer,
  type SharedViewModel,
  type SharedWorkbookViewerProps,
} from './workbook-viewer'

export type ShareViewerIntent =
  | { type: 'select-view'; publicViewId: string }
  | { type: 'select-item'; publicViewId: string; publicItemId: string }
  | { type: 'select-connection'; publicViewId: string; publicConnectionId: string }
  | { type: 'clear-selection' }
  | { type: 'fit-view' }
