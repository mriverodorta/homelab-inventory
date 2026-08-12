# Catalog Repeat-Start And Workspace Tab Design

## Goal

Reduce repeated container startup time without weakening catalog trust, then fix Canvas workspace tabs so the selected workspace color covers the complete tab, including its action-menu area.

This work is developed and verified locally. It does not bump the application version, push `main`, publish a Docker image, or modify live data.

## Current Behavior

Each catalog generation already contains an immutable `catalog.sqlite` index. The long repeat-start path is not rebuilding that index. Startup currently reads and parses the full signed snapshot, digest index, and facet artifact, validates every catalog definition and relationship, recomputes the snapshot digest, compares all digest observations, and only then opens the existing SQLite index.

That work correctly protects activation but is unnecessarily repeated for an unchanged generation. On the current live catalog it delays HTTP readiness by roughly 30 seconds after Docker's normal restart handling. Once ready, the existing index serves facets and searches in milliseconds.

The workspace-tab defect has a separate cause. The selected color is applied only to the label button. The sibling action-menu region inherits the outer neutral background, creating a white square at the tab's right edge both before and during hover.

## Architecture

### Immutable Catalog Verification Receipt

Catalog activation remains the only path that accepts new registry content. It continues to perform the complete existing checks:

- trusted-key signature verification;
- manifest and artifact hash verification for connected refreshes;
- catalog schema and contract validation;
- template and digest-index relationship validation;
- signed facet validation;
- transactional SQLite index construction and verification.

After the SQLite index is complete and closed, activation writes an atomic verification receipt into the immutable generation directory. The receipt contains:

- receipt format version;
- catalog revision and catalog digest;
- catalog contract version and fingerprint version;
- SQLite index schema version;
- SHA-256 and byte size for the stored snapshot, digest, facet, and SQLite files;
- template and facet-category counts;
- verification timestamp.

The receipt is written to a temporary file with mode `0600`, synchronized, and renamed only after every artifact and the SQLite index have been fully verified. The active-generation pointer is not changed until the receipt is durable.

The receipt is an integrity acceleration record, not a new trust root. Registry signatures remain authoritative. A process that owns and can rewrite the entire `/data` directory is already inside the application's persistence trust boundary.

### Repeat-Start Fast Path

For an unchanged active catalog generation, startup performs only bounded checks:

1. Match active registry state, active-generation pointer, directory name, and receipt revision/digest.
2. Require the supported receipt format, catalog contract, fingerprint, and SQLite schema versions.
3. Verify expected files are regular files with the recorded byte sizes.
4. Stream SHA-256 over the immutable artifacts and SQLite index without parsing JSON.
5. Open SQLite read-only and run `PRAGMA quick_check`, `PRAGMA foreign_key_check`, schema-version validation, and constant-time generation metadata checks.
6. Read the compact facet payload from SQLite into the existing process-local facet cache.

The fast path never rebuilds, mutates, or downloads catalog data. It avoids deserializing and semantically revalidating the complete catalog when the exact generation was already validated during activation.

Legacy generations without a receipt use the full existing validation once, verify or rebuild the index, and atomically add a receipt. This upgrades existing installations automatically without a schema migration or user action.

### Recovery State Machine

Catalog startup has explicit states: `unavailable`, `verifying`, `ready`, and `recovering`.

- No active snapshot: catalog remains `unavailable`; application startup proceeds normally.
- Valid receipt and index: catalog becomes `ready` through the fast path.
- Missing receipt: run one full validation and create the receipt before catalog readiness.
- Receipt, hash, schema, or SQLite integrity mismatch: application startup continues, catalog becomes `recovering`, and one single-flight background recovery validates the signed artifacts and transactionally rebuilds the index and receipt.
- Unrecoverable signed-artifact failure: catalog becomes `unavailable` with a sanitized error. Inventory, canvas, authentication, telemetry, agents, and settings remain available.

During `verifying` or `recovering`, catalog facet/search/template routes return a stable `503 catalog-initializing` response with a retry-safe public message. They never serve an index whose fast-path checks failed. Connected refresh and user-triggered refresh share the same single-flight transition and cannot race index recovery.

Activation of a new valid revision atomically swaps generations, clears all path/facet initialization state, and makes the new receipt/index visible together. The previous immutable generation remains available for the existing backup and rollback behavior.

### Startup Profiling

A local benchmark command records monotonic durations for:

- persistence initialization;
- authentication and installation identity initialization;
- catalog path resolution;
- artifact hashing;
- SQLite integrity checks;
- facet hydration;
- HTTP listener availability.

Phase instrumentation is injected through an optional observer and remains silent in normal production execution. The observer and benchmark harness stay as test tooling because they prevent future startup regressions; temporary exploratory logging is removed before the final commit.

## Workspace Tab Styling

The workspace color is applied to the `WorkbookTab` container rather than only the label button. The label and menu trigger remain transparent so the complete selected tab is one uninterrupted surface.

The action trigger keeps a stable `24px` layout slot even when visually hidden, preventing the tab width and label from shifting on hover. Its idle opacity is zero; hover, keyboard focus, and open-menu states reveal the icon. The button's hover/focus background is a subtle translucent overlay derived from the selected surface, never a neutral white square. The colored bottom edge remains above the full tab width.

Inactive tabs retain the existing neutral background and interaction behavior. Systems stays fixed, neutral, and first. Dragging, keyboard focus, menu access, truncation, and mobile horizontal overflow remain unchanged.

## Data And Compatibility

- No application database schema change is required.
- Existing catalog generations remain readable.
- Existing complete and registry-related backups already include generation directories; the receipt is included automatically with those files.
- Restore of an older backup without a receipt triggers one full verification and receipt creation.
- Unsupported catalog contracts, fingerprint versions, receipt versions, or SQLite schemas fail closed for the catalog.
- Demo mode uses the same immutable-generation fast path but retains its existing no-enrollment and no-contribution policy.

## Testing

### Catalog Unit And Integration Tests

- activation writes a complete receipt only after index verification;
- repeat startup uses the fast path without calling full snapshot validation;
- artifact, receipt, index, schema, and generation-identity corruption each fail the fast path;
- corruption never exposes catalog search results before recovery completes;
- legacy generation creates a receipt once and uses the fast path afterward;
- concurrent warm, search, refresh, and recovery operations share one initialization;
- new revision invalidates the previous receipt/path/facet state;
- recovery failure returns sanitized `503` responses while non-catalog APIs stay healthy;
- demo stores remain isolated.

### Workspace Tab Tests

- the active color is on the complete tab container;
- the label and action trigger do not introduce independent opaque backgrounds;
- the action slot stays present before and during hover;
- mouse, keyboard, menu-open, drag, inactive, and Systems states remain valid.

### Local Docker Proof

Build the final pinned distroless image locally for `linux/amd64`, mount a copied development data directory, and perform:

1. first start from a legacy generation;
2. clean repeated restart;
3. restart after receipt corruption;
4. restart after SQLite corruption;
5. activation of a different catalog revision fixture;
6. UI test of Add Hardware categories and workspace-tab idle/hover/menu states;
7. browser console and container-log audit;
8. inventory/project/telemetry hash comparison proving no user-domain mutation.

Run the existing AMD64 and ARM64 distroless security preflight after functional verification.

## Performance Targets

- Clean repeated container startup reaches application health in under 10 seconds on the local Docker environment, excluding Docker image pull time.
- The catalog portion of repeat startup completes in under 2 seconds for the current copied catalog.
- First facets response after health completes in under 100 ms locally.
- First selected category displays its first page in under 500 ms locally.
- Repeat startup performs no full JSON catalog parse and no index rebuild.
- Process memory remains bounded to the SQLite runtime, hashes in flight, and one compact facet response; the complete catalog is not retained in memory.

## Release Discipline

Record the startup optimization and workspace-tab visual fix in the Unreleased changelog and structured release-note draft. Do not bump semver, tag, push, or deploy until the user explicitly requests the next release.
