# @homelab-inventory/viewer-model

Framework-neutral, immutable read models for validated Homelab Inventory shares.

## API

- `createSharedWorkbookModel` preserves manifest view order.
- `createSharedSystemsModel` projects a read-only Systems table.
- `createSharedCanvasModel` resolves nodes, ports, endpoints, and persisted routes while rejecting broken references.
- `parseShareDeepLink` reads generated public view, item, and connection IDs.
- Presentation helpers keep natural text ordering and public-ID handling consistent between the private app and public viewer.

The package does not import React, editors, route workers, persistence, authentication, or telemetry transports.

## Physical computer labels (0.1.1)

Systems and canvas constructors accept an optional second argument, a `SharedPresentationContext`:

```ts
{ version: 1, registryClasses: [{ templateKey, templateRevision, contentHash, physicalClass: 'desktop' }] }
```

The consumer must derive this evidence from its validated, trusted exact Registry definition, never the latest template or local overrides. `parseSharedPresentationContext` validates transport shape and rejects conflicting exact identities; it does not verify Registry signatures. Only evidence matching all three identity fields is used. Custom items read their validated definition's `hardwareClass`.

Models add a presentation-only `typeLabel`; inputs, IDs, `type`, hashes and relationships are unchanged. Do not serialize model rows back into signed share blobs. `sharedItemTypeLabel` supplies Desktop PC, Laptop, Workstation or Server for recognized compute classes, Computer for unknown legacy compute, and NAS/PC Build for those categories. Role, name, chassis and memory packaging never determine physical class.

## Versioning

Package versions follow independent SemVer. Consumers should pin the exact version used by their renderer and upgrade only after running the frozen fixture suite.
