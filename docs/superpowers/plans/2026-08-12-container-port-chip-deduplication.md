# Container Port Chip Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each unique container port binding once as a combined host-to-container chip with its protocol.

**Architecture:** Keep raw agent telemetry unchanged and normalize bindings inside the existing presentation formatter. Deduplicate exact host-port, container-port, and protocol tuples before producing one chip per mapping, preserving distinct TCP and UDP bindings.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, shadcn/ui Badge

## Global Constraints

- Do not change the agent protocol, backend ingestion, persistence schema, or stored telemetry.
- Render mappings as `H <host> → C <container> · <PROTOCOL>`.
- Deduplicate exact `(hostPort, containerPort, lowercase protocol)` tuples.
- Preserve separate mappings when any tuple field differs.
- Do not bump the application version, create a tag, or deploy.

---

### Task 1: Deduplicate and combine container port chips

**Files:**
- Modify: `src/components/inspector/agent/agent-container-formatters.ts`
- Test: `src/test/agent-telemetry-presentation.test.tsx`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Consumes: `AgentContainer.ports?: AgentContainerPort[]`
- Produces: `containerChips(container: AgentContainer): ContainerChip[]`

- [ ] **Step 1: Write failing presentation tests**

Extend the container presentation test with duplicate TCP bindings plus a UDP binding:

```tsx
ports: [
  { hostPort: 6881, containerPort: 6881, protocol: 'tcp' },
  { hostPort: 6881, containerPort: 6881, protocol: 'tcp' },
  { hostPort: 6881, containerPort: 6881, protocol: 'udp' },
]
```

Assert `H 6881 → C 6881 · TCP` occurs once, `H 6881 → C 6881 · UDP` occurs once, and standalone `H 6881`, `C 6881`, `TCP`, and `UDP` labels are absent.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
bun run test -- src/test/agent-telemetry-presentation.test.tsx
```

Expected: the combined labels are absent because the formatter still emits three standalone chips per raw binding.

- [ ] **Step 3: Implement tuple deduplication**

In `containerChips()`, maintain a `Set<string>` keyed by `${hostPort}:${containerPort}:${protocol.toLowerCase()}`. Skip previously seen keys and emit:

```ts
{
  key: `port-${hostPort}-${containerPort}-${protocol}`,
  label: `H ${hostPort} → C ${containerPort} · ${protocol.toUpperCase()}`,
}
```

Leave service and network metadata handling unchanged.

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun run test -- src/test/agent-telemetry-presentation.test.tsx
```

Expected: all presentation tests pass.

- [ ] **Step 5: Update user-facing release documentation**

Add one concise Unreleased fix to `CHANGELOG.md` and one matching item to `UNRELEASED_RELEASE_NOTES.fixes` in `src/release-notes.ts`, explaining that duplicate IPv4/IPv6 container bindings collapse into one directional mapping chip.

- [ ] **Step 6: Run standard verification**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all commands pass; existing nonblocking warnings may remain.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/components/inspector/agent/agent-container-formatters.ts \
  src/test/agent-telemetry-presentation.test.tsx \
  CHANGELOG.md src/release-notes.ts
git commit -m "fix: deduplicate container port chips"
```
