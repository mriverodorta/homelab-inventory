# Automatic Safe Registry Updates

## Objective

Make registry linking useful at large scale by automatically applying cryptographically verified official catalog updates that can be proven safe, while retaining explicit review for potentially breaking or unprovable changes.

The feature must handle inventories with thousands of linked items without requiring repetitive review, causing project revision storms, resetting canvases, or recalculating cable routes when topology has not changed.

## Trust Boundary

Automatic updates apply only to the official Homelab Inventory Registry when its catalog artifacts verify against a configured trusted signing key.

Private templates, offline catalogs, custom sources, unsigned artifacts, and artifacts signed by an untrusted key remain review-before-apply. Connected mode alone does not establish trust.

The setting **Automatically apply safe official catalog updates** is enabled by default for existing and new installations using the official registry. Demo mode forces this behavior on so demo sessions stay current, while retaining the existing prohibition on enrollment and contributions.

## Update Run Architecture

After a verified official catalog revision activates, the backend creates one update run for that catalog revision.

1. Collect linked items whose templates have newer revisions.
2. Group links by template key and target revision.
3. Build proposed inventory records while preserving local-only fields.
4. Simulate affected projects once per project rather than once per item.
5. Classify each linked item as `safe`, `review-required`, `blocked`, or `skipped`.
6. Apply all safe items in one atomic SQLite transaction.
7. Revalidate catalog hashes and project revisions before commit.
8. Persist the run, evaluations, decisions, reason codes, and affected links.
9. Publish one summarized frontend state update.

Within one template group, safe copies may update automatically while conflicting copies remain pending. A newer template revision supersedes declined decisions for an older revision.

## Safety Classification

An update is safe only when every applicable condition passes:

- The official artifact signature and trusted signing key are verified.
- Template key, inventory type, and product identity remain stable.
- The item has no local override; edited items remain detached under the existing behavior.
- The update introduces no compatibility warning or error.
- Existing compatibility findings do not increase in count or severity.
- Assigned components remain valid in their hosts.
- Occupied slots are not removed, reduced, or materially changed.
- Connected ports and endpoint identities remain valid.
- Assignments, placements, cables, and route-cache references remain valid.
- Local names, notes, scope, assignments, and placements remain preserved.

The update evaluator combines impact simulation with a hard-deny list for identity/type changes and destructive topology changes.

Examples:

- Adding missing i7-10700T socket, generation, and TDP information removes findings and is safe.
- Correcting cache size or clock data without changing identity is safe.
- Reducing four RAM slots to two while the removed slots are occupied is blocked.
- Removing a connected network port is blocked.
- Changing a CPU from LGA1200 to AM5 requires review.
- Changing template type or product identity is never automatic.

Compatibility-changing updates that remain structurally valid may be manually approved after confirmation. Structurally invalid updates cannot be forced until their dependencies are resolved.

## Persistence Model

SQLite persists:

- The registry update policy.
- One update run per source and catalog revision.
- Per-link evaluations with machine-readable reason codes.
- Applied, declined, blocked, superseded, and failed decisions.
- Source and target template revisions and content hashes.
- The user identity responsible for manual approval or decline.

Every new primary and foreign key is a positive numeric relational ID. Template keys and content hashes describe catalog identity and versions but are never used as database primary keys.

Declining an update skips only that template revision for the affected links. The links remain attached. A newer revision is evaluated and offered again. Detaching an item remains a separate explicit action.

## Atomicity And Recovery

Evaluation and application are idempotent. Restarting during a run resumes or retries the same run without creating duplicate applications or decisions.

Safe updates are committed atomically. A stale catalog content hash, changed project revision, validation failure, or persistence error aborts the transaction and leaves inventory, assignments, projects, and registry links unchanged.

Catalog activation is independent from update application. If evaluation fails, the verified catalog remains active, the run is marked failed, and the UI exposes an error and bounded retry action. Retries use backoff and cannot create a retry loop.

Complete and registry-enrollment backup sections include the policy and decision history. Restore validation preserves valid references and marks obsolete evaluations for recalculation rather than trusting results produced from different project or catalog state.

## Review Interface

The bottom toolbar gains a permanent registry-update button using the Lucide `CloudDownload` icon.

- The button remains visible even when no update requires attention.
- A badge displays the number of template-revision groups requiring review, not the number of inventory copies.
- The tooltip reports the most recent automatic run.
- Clicking the button opens the dedicated **Registry updates** dialog.

The dialog provides:

- **Review**, **Applied**, and **Declined** views.
- Search and filters for category, project, reason, and status.
- Template-revision grouping with affected-item counts.
- Expandable before/after definitions and affected inventory/project lists.
- Multi-selection with **Approve selected** and **Decline selected**.
- Clear dependency explanations for blocked updates.
- A reconsider action for declined revisions.

For example, six linked copies of one CPU appear as:

> Intel Core i7-10700T | revision 2 to 3 | affects 6 linked items

One decision handles the group. If five copies are safe and one conflicts, the five update automatically and the review group contains only the remaining copy.

The notification center receives one summary after each automatic run, such as:

> Applied 847 verified registry updates. Three update groups require review.

## Performance Requirements

For 1,000 linked updates, processing must use:

- One catalog update run.
- Grouped template analysis.
- Bounded simulation per affected project.
- One atomic persistence commit for safe updates.
- One summarized frontend refresh.

The implementation must not issue one request, project revision, React state update, canvas rebuild, or cable-routing operation per inventory item. Canvas and route state may change only when an applied update materially changes relevant topology.

## Test Coverage

Tests must cover:

- Trusted official artifacts versus untrusted, private, and offline sources.
- Safe CPU repair applied to 1, 6, and 1,000 linked copies.
- Mixed groups where safe copies update and conflicting copies remain pending.
- RAM slot/capacity reductions and occupied expansion-slot changes.
- Connected-port removal and motherboard topology changes.
- Incompatible CPU revisions.
- Preservation of local fields, assignments, placements, cables, and route cache.
- Decline, reconsider, and superseding revision behavior.
- Batch atomicity, stale hashes, concurrent project mutations, and restart recovery.
- Idempotent reruns and bounded failure retries.
- One project/frontend update per batch rather than per item.
- Grouped toolbar badge counts.
- Demo-mode and trusted-signature enforcement.
- Backup, export, and restore round trips.
- Migration of existing installations with automatic safe updates enabled.

## Acceptance Criteria

- Safe signed official updates apply without user intervention.
- Risky or unprovable changes remain reviewable.
- Structural conflicts are never force-applied.
- Large linked inventories do not require per-copy review.
- Update runs cannot partially commit.
- Existing topology and route state remain unchanged when an update does not affect them.
- The revision-3 i7-10700T repair automatically updates all six eligible linked copies and removes HP EliteDesk compatibility findings.
- Existing lint, unit, integration, build, migration, backup, and container-security checks pass.
