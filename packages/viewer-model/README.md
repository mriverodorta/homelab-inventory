# @homelab-inventory/viewer-model

Framework-neutral, immutable read models for validated Homelab Inventory shares.

## API

- `createSharedWorkbookModel` preserves manifest view order.
- `createSharedSystemsModel` projects a read-only Systems table.
- `createSharedCanvasModel` resolves nodes, ports, endpoints, and persisted routes while rejecting broken references.
- `parseShareDeepLink` reads generated public view, item, and connection IDs.
- Presentation helpers keep natural text ordering and public-ID handling consistent between the private app and public viewer.

The package does not import React, editors, route workers, persistence, authentication, or telemetry transports.

## Versioning

Package versions follow independent SemVer. Consumers should pin the exact version used by their renderer and upgrade only after running the frozen fixture suite.
