# Alpine Agent Command Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Alpine Linux as a first-class Agent setup and maintenance target whose generated commands work from an existing root shell without `sudo`.

**Architecture:** Extend the backend command contract with an `alpine` key while reusing Linux artifacts. Centralize operating-system-to-command-target selection in the server response, pass that target to Inspector surfaces, and keep setup selection explicit for hosts that are not enrolled yet.

**Tech Stack:** React, TypeScript, Bun, Express Agent routes, embedded Go Agent release assets, Vitest and Testing Library.

## Global Constraints

- Alpine uses existing Linux AMD64/ARM64 artifacts and `install.sh`.
- Alpine commands contain no `sudo` and assume the shell already runs as root.
- Do not run or recommend `apk add`.
- Linux and FreeBSD/OPNsense commands remain unchanged.
- Existing response fields remain backward compatible; `alpine` is additive.
- Demo mode continues to disable every Agent setup target.
- Update unreleased structured release notes and `CHANGELOG.md`; do not bump the version before deployment.

---

### Task 1: Typed Backend Alpine Commands

**Files:**
- Modify: `server/agents/release-service.mjs`
- Modify: `server/agents/release-service.test.mjs`
- Modify: `server/agents/v1-routes.test.mjs`
- Modify: `server/agent-routes.test.mjs`

**Interfaces:**
- Consumes: Linux `install.sh`, current release version, endpoint, enrollment token, and container options.
- Produces: `{ linux: string, alpine: string, freebsd: string }` from both `installCommands` and `upgradeCommands`.

- [ ] **Step 1: Extend failing release-service expectations**

Assert `commands.alpine` references `install.sh`, preserves all enrollment/container arguments, and does not match `/\bsudo\b/`. Assert native Alpine update equals `homelab-inventory-agent update` and legacy Alpine update uses `sh -s -- ... --upgrade` without `sudo`.

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
bun run test -- server/agents/release-service.test.mjs server/agents/v1-routes.test.mjs server/agent-routes.test.mjs
```

Expected: Alpine fields are missing.

- [ ] **Step 3: Add Alpine command output**

Return the additive field in both command builders:

```js
return {
  linux: `curl -fsSL ${shellArgument(`${base}/install.sh`)} | sudo sh -s -- ${common}`,
  alpine: `curl -fsSL ${shellArgument(`${base}/install.sh`)} | sh -s -- ${common}`,
  freebsd: `fetch -q -o - ${shellArgument(`${base}/install-freebsd.sh`)} | sudo sh -s -- ${common}`,
}
```

For native updates, return `alpine: 'homelab-inventory-agent update'`.

- [ ] **Step 4: Update route fixtures and pass focused tests**

Update exact command maps in route tests, then rerun the focused command from Step 2. Expected: all pass.

- [ ] **Step 5: Commit backend contract**

```bash
git add server/agents/release-service.mjs server/agents/release-service.test.mjs server/agents/v1-routes.test.mjs server/agent-routes.test.mjs
git commit -m "fix: generate root-safe Alpine agent commands"
```

### Task 2: Runtime Command Target Projection

**Files:**
- Create: `server/agents/command-platform.mjs`
- Create: `server/agents/command-platform.test.mjs`
- Modify: `server/agent-routes.mjs`
- Modify: `server/systems/read-service.mjs`
- Modify: `server/systems/read-service.bun_spec.ts`
- Modify: `src/types/agent.ts`

**Interfaces:**
- Produces: `agentCommandPlatform(operatingSystem): 'linux' | 'alpine' | 'freebsd'`.
- Produces: `commandPlatform` on Agent status payloads and correct `agentUpdateCommand` in Systems projections.

- [ ] **Step 1: Write platform-classification tests**

Assert `Alpine Linux 3.22` and `alpine` map to `alpine`; `FreeBSD` and `OPNsense` map to `freebsd`; Ubuntu, empty, and unknown values map to `linux`.

- [ ] **Step 2: Implement the classifier**

```js
export function agentCommandPlatform(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized.includes('alpine')) return 'alpine'
  if (normalized.includes('freebsd') || normalized.includes('opnsense')) return 'freebsd'
  return 'linux'
}
```

- [ ] **Step 3: Project command target through status and Systems**

Use the latest telemetry system operating-system value to select the command key. Include `commandPlatform` in Agent host status. Select Systems `agentUpdateCommand` from `upgradeCommands(...)[commandPlatform]` instead of always `.linux`.

- [ ] **Step 4: Extend TypeScript contracts**

Add:

```ts
export type AgentCommandPlatform = 'linux' | 'alpine' | 'freebsd'
```

Add `alpine: string` to install/upgrade command maps and optional `commandPlatform` to status for backward compatibility.

- [ ] **Step 5: Run projection tests**

```bash
bun run test -- server/agents/command-platform.test.mjs server/systems/read-service.bun_spec.ts server/agent-routes.test.mjs
```

Expected: Alpine uses the non-sudo update command; Linux and FreeBSD remain unchanged.

- [ ] **Step 6: Commit runtime projection**

```bash
git add server/agents/command-platform.mjs server/agents/command-platform.test.mjs server/agent-routes.mjs server/systems/read-service.mjs server/systems/read-service.bun_spec.ts src/types/agent.ts
git commit -m "fix: select agent commands by host platform"
```

### Task 3: Agent Inspector Setup And Maintenance UI

**Files:**
- Modify: `src/components/inspector/agent/agent-setup-panel.tsx`
- Modify: `src/components/inspector/agent/agent-hardware-evidence.tsx`
- Modify: `src/test/inspector-panel.test.tsx`

**Interfaces:**
- Consumes: `AgentCommandPlatform`, three-key install/upgrade maps, and status `commandPlatform`.
- Produces: explicit Alpine setup selection plus platform-correct update and inventory commands.

- [ ] **Step 1: Add failing UI tests**

Render an unregistered host and assert the OS selector contains Linux, Alpine Linux, and FreeBSD / OPNsense. Select Alpine, generate enrollment, and assert the displayed exact backend Alpine command contains no `sudo`. Render an enrolled Alpine host and assert update and scan commands contain no `sudo`.

- [ ] **Step 2: Add Alpine to setup state and selector**

Type setup state as `AgentCommandPlatform`, add `<SelectItem value="alpine">Alpine Linux</SelectItem>`, and continue selecting the exact backend command without string rewriting.

- [ ] **Step 3: Use projected platform for maintenance commands**

Use `liveStatus.commandPlatform ?? 'linux'` for upgrade selection. Pass that value to `AgentHardwareEvidence` and compute its command as:

```ts
const command = commandPlatform === 'alpine'
  ? 'homelab-inventory-agent inventory'
  : 'sudo homelab-inventory-agent inventory'
```

- [ ] **Step 4: Run Inspector tests**

```bash
bun run test -- src/test/inspector-panel.test.tsx
```

Expected: setup, demo, Alpine, Linux, FreeBSD, update, and inventory assertions pass.

- [ ] **Step 5: Commit UI support**

```bash
git add src/components/inspector/agent/agent-setup-panel.tsx src/components/inspector/agent/agent-hardware-evidence.tsx src/test/inspector-panel.test.tsx
git commit -m "fix: expose Alpine agent setup commands"
```

### Task 4: Release Documentation And Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `config/unreleased-release-note.json`

**Interfaces:**
- Consumes: completed Alpine command behavior.
- Produces: consolidated unreleased release documentation and release-ready evidence.

- [ ] **Step 1: Add user-visible release notes**

State that Alpine is now selectable during Agent setup and generated install, update, and hardware scan commands work from a root shell without requiring `sudo`.

- [ ] **Step 2: Run mandatory verification**

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

Expected: all checks pass and both final image architectures have zero Scout and Trivy findings at every severity.

- [ ] **Step 3: Commit documentation**

```bash
git add CHANGELOG.md src/release-notes.ts config/unreleased-release-note.json
git commit -m "docs: note Alpine agent command support"
```

