# Computer Classification: Shared Viewer Coordination

## Coordinated Implementation Update

The original assessment below is retained for context. The shared viewer changes are now implemented in Viewer Model/React 0.1.1. Laptop catalog support follows frozen contract v13 and Catalog Protocol 0.2.0; exact npm artifact verification and coordinated consumer readiness remain mandatory before Registry publication. Do not infer deployment readiness from these source changes.

## Original Handoff

## Application Work

The app preserves the persisted `server` inventory category, all numeric IDs and all relationships. Computer is its category display label; individual hosts use Desktop PC, Laptop, Workstation or Server according to `hardwareClass`. `usageRole` remains independent. SQLite migration 0038 extends the class constraint without reclassifying existing data. Mini/Micro/Tiny and DIMM/SO-DIMM remain chassis and memory form factors.

No Share Contract, Catalog Protocol or viewer package version has been changed or published by this task. No LabGD deployment or signed catalog modification is authorized by this handoff.

## Current Sharing Evidence

- `server/sharing/share-projector.mjs` keeps `PublicItem.type = item.type`, so compute items still carry `server`.
- Custom definitions already include allowlisted `hardwareClass` through `server/sharing/privacy-policy.mjs`.
- Registry sources carry an exact template key, revision and content hash. Do not resolve them against the latest template instead.
- `packages/viewer-react/src/{systems-viewer,canvas-viewer,share-inspector}.tsx` currently renders `item.type` directly.
- PublicItem is a strict object. Adding a top-level physical-class field without coordinated schema support would break older consumers.

## Required Joint Design and Implementation

1. Prefer deriving a viewer-only physical label from validated custom-definition hardwareClass or the exact resolved Registry definition. Verify the LabGD resolution pipeline can supply that evidence without modifying the stored signed or content-addressed share bytes.
2. Map recognized classes only: desktop to Desktop PC, laptop to Laptop, workstation to Workstation, server to Server. Keep NAS and PC Build behavior. When legacy compute data has no verified class, display Computer; do not infer from name, RAM packaging or role.
3. If resolution cannot supply classification, agree on a versioned, explicitly negotiated optional projection field before changing the payload. Do not overload usageRole or replace inventory identity.
4. Implement the shared presentation in the application-owned viewer packages, publish exact package versions after approval, and have LabGD update its pinned package/integrity evidence. Avoid a second independently maintained label implementation.
5. Test existing immutable shares unchanged, new custom laptops, exact historical Registry definitions, missing/unknown classes, laptops used as servers, full-page/embed/inspector views, social previews and deep links.
6. Deploy consumers before producers if a contract amendment is required. Existing shares must not require republishing; old hashes, IDs and ownership remain unchanged.

## Registry Dependency

Laptop catalog publication is a separate coordinated Catalog Protocol change. See `2026-11-04-registry-laptop-class.md`. Existing desktops, workstations and servers retain their types and identity hashes. Local laptops are not submitted as desktop templates while support is absent.

## Safety

Use frozen synthetic fixtures or isolated loopback services only. Do not enroll previews, refresh live catalogs, publish test shares or contact production LabGD. Do not modify historical payloads or signed Registry snapshots to fix presentation.
