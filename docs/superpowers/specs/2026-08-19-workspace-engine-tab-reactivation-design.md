# Workspace Engine Tab Reactivation Design

## Problem

The Systems workspace intentionally disables and disposes the Canvas domain engine because Systems does not render geometry, route cables, or execute Canvas commands. The current disabled state is represented as a synthetic `ready` engine state. When the user returns to a Canvas workspace, the provider creates a fresh idle engine client but can briefly continue exposing the prior synthetic `ready` state.

That stale readiness lets engine-dependent Canvas consumers run before the new worker and WASM snapshot are ready. Repeated Systems and Canvas transitions can therefore produce `Workspace engine is not ready` warnings until the browser is refreshed.

## Approved Behavior

- The domain engine remains disabled and releases its worker, WASM instance, project snapshot, engine event stream, and routing state while a Systems workspace is active.
- The selected inventory item and open inspector remain preserved when moving between Systems and Canvas workspaces.
- Returning to Canvas creates a new engine activation session and does not expose Canvas engine behavior until that session is genuinely ready.
- If selection centering is enabled, the preserved selected item is centered once after the new Canvas engine session becomes ready.
- If selection centering is disabled, the preserved selection and inspector remain open without moving the Canvas viewport.
- Genuine startup failures continue to use the existing engine failure and retry interface.
- Systems workspace behavior and live telemetry remain independent of the Canvas engine.

## Engine Activation Sessions

Add a monotonically increasing activation session identifier to the domain-engine context. A new session begins whenever the provider transitions from disabled to enabled and creates the client that will own that activation.

Enabling the engine is one coherent state transition:

1. Create the new client.
2. Clear the previous synchronization event.
3. Expose the new client's actual initial state, normally `idle` with no revision.
4. Increment the activation session identifier.
5. Mark the provider enabled and start the client.

Disabling the engine exposes an inactive, non-ready state and clears synchronization data before disposing the prior client. Disabled mode must never masquerade as a ready engine.

The delayed disposal used to tolerate React effect cleanup remains scoped to the client that scheduled it. An old disposal callback must never dispose a newer session's client.

## Readiness Gate

The engine gate tracks readiness per activation session instead of remembering that any prior client was ready.

- Disabled mode renders non-Canvas workspaces normally.
- A newly enabled session keeps the application mounted to preserve selection and inspector state, but blocks engine-dependent Canvas behavior until that session reaches `ready`.
- After the current session has reached `ready`, routine rebuilding or conflict recovery may continue using the existing nonblocking behavior.
- A prior session's readiness cannot authorize a new session.
- Failed and unsupported states continue to present the existing recovery interface.

Because the gate wraps the complete application, a reactivation must not unmount its children. After the application has rendered in disabled mode, activation keeps those children mounted behind the existing loading overlay. Canvas hooks may render while the provider is still disabled or loading during the workspace selection commit, but they must remain inert because both `enabled` and current-session readiness are false. They become active only after the provider starts and readies the new session.

## Query Isolation

Engine query caches with infinite stale time must include the activation session identifier in their query keys. This applies to topology and any other query whose result belongs to the in-memory engine snapshot.

Changing sessions therefore forces a read from the new engine instead of reusing data produced by a disposed client. Project identity and topology fingerprints remain in the key for their existing invalidation behavior.

## Selection And Centering

Selection and inspector state remain owned by the application, not by the Canvas engine, so they survive workspace changes.

When a Canvas activation session first reaches `ready`:

- If an item remains selected and automatic selection centering is enabled, request focus for that item once for the session.
- Resolve component selections to their containing host through the existing selection controller.
- Do not center before the Canvas controller is mounted and the engine is ready.
- Do not repeat centering for synchronization events, rebuilds, telemetry updates, or ordinary renders within the same session.
- Connection selections remain preserved but are not converted into equipment-centering requests.

## Error Handling

Normal Systems-to-Canvas activation is a loading transition, not a warning condition. Inspector code and Canvas commands must not surface `Workspace engine is not ready` while the readiness gate is performing that transition.

If startup genuinely fails, the provider retains the failed state and the gate offers the existing retry action. Retrying remains within the current activation session unless the user leaves Canvas and starts another activation later.

## Testing

Add regression coverage for:

- Systems to Canvas activation starting a fresh idle client, preserving mounted application state, and withholding engine behavior until it is ready.
- Canvas to Systems to Canvas creating a distinct session and disposing only the old client.
- A prior session's `ready` state never authorizing a new session.
- Rapid tab switching never allowing an old disposal timer to terminate the current client.
- Topology and compatible-endpoint queries not reusing cache entries across sessions.
- Selected item and inspector state remaining intact across workspace changes.
- Automatic centering occurring once after current-session readiness when enabled.
- No centering occurring when the preference is disabled.
- No engine startup, event stream, geometry synchronization, or routing work while Systems remains active.
- Genuine startup failure and retry behavior remaining available.

Use focused provider, gate, query, and application-controller tests, followed by the complete lint, test, and production build checks. Browser verification must repeatedly switch between Systems and Canvas with the inspector open and closed, verify the selected item remains selected, verify optional centering, and confirm that no engine warning or console error occurs.

## Release Notes

Record this as a user-visible Canvas lifecycle fix in the unreleased structured release notes and the `Unreleased` changelog. No version bump is made until deployment is explicitly requested.

## Out Of Scope

- Keeping the domain engine resident while Systems is active.
- Adding cable or geometry operations to the Systems inspector.
- Changing Canvas routing, persistence, or topology semantics.
- Changing the visual design of the engine loading or failure interface.
