# Homelab Inventory Website Pre-Ship Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the public website up to date with the shipped Homelab Inventory product while presenting LabGD sharing and embeds accurately as in-progress work until live certification completes.

**Architecture:** Treat the public roadmap database as status authority and the deployed app, README, changelog, and release notes as capability authority. Refresh the existing restrained infrastructure-focused page and assets without coupling website deployment to the Application or LabGD release.

**Tech Stack:** Bun, React, Hono, PostgreSQL roadmap service, Playwright/deployment tests, existing website design system.

## Global Constraints

- Execute in `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryWeb/landing`.
- Start from handoff commit `c094e0fd5eedbcbfa7ed5b1ec8fb4efc82674a6a` or a reviewed descendant.
- Use the `impeccable` skill for visual and interaction work.
- Follow `docs/2026-08-22-current-product-refresh-handoff.md` completely.
- Keep roadmap proposals 20 and 21 `in_progress` throughout this plan.
- Do not claim that LabGD sharing is available, shipped, or ready to use before Plan 04 completes.
- Do not expose production inventory, private screenshots, addresses, tokens, credentials, or unpublished share URLs.
- Do not alter GitHub OAuth, moderation, CSRF, rate limits, analytics privacy, or roadmap persistence unless required by the handoff and covered by tests.

---

### Task 1: Capture The Current Public Baseline

**Files:**
- Verify: `apps/web/src/App.tsx`
- Verify: `apps/web/src/roadmap/RoadmapApp.tsx`
- Verify: `docs/2026-08-22-current-product-refresh-handoff.md`

**Interfaces:**
- Consumes: live homepage, live roadmap, app `0.14.1`, and current handoff.
- Produces: an accuracy and asset inventory.

- [ ] **Step 1: Inspect the public site**

Capture desktop and mobile screenshots of `https://homelabinventory.com` and `/roadmap`, record console errors and failed requests, and inventory current headings, feature claims, screenshots, metadata, structured data, and sitemap entries.

- [ ] **Step 2: Compare every claim to canonical sources**

Use the app README, changelog, structured release notes, and live behavior. Record and remove obsolete Lowdb, authentication-planned, single-project, missing-Agent, and missing-Registry statements.

- [ ] **Step 3: Verify roadmap state**

Record the 21-proposal baseline and confirm proposals 20 and 21 are `in_progress` before any page change.

### Task 2: Refresh The Product Narrative And Assets

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css` or the existing page stylesheet used by `App.tsx`
- Modify: existing public assets under `apps/web/public/`
- Test: `apps/web/src/App.test.tsx` or the existing homepage test file

**Interfaces:**
- Consumes: shipped capability inventory in the handoff.
- Produces: current, evidence-backed public product page.

- [ ] **Step 1: Write failing content assertions**

Add tests that require SQLite persistence, multiple projects/workspaces, Registry catalog, Agent telemetry, authentication/roles, backups, notifications, custom metadata, AMD64/ARM64 distroless delivery, and an explicitly in-progress LabGD section.

- [ ] **Step 2: Run the web tests and verify failure**

```bash
bun run test:web
```

- [ ] **Step 3: Implement the content hierarchy**

Use the six product pillars in the handoff. Keep descriptions short enough for organic visitors to understand the product without opening GitHub or Docker Hub. Use actual application screenshots or recordings that reveal the Systems, Canvas, Registry, Agent, and settings experiences.

- [ ] **Step 4: Add the LabGD in-progress section**

Describe privacy-reviewed read-only Systems/Canvas sharing, interactive embeds, protected/unlisted modes, deep links, and static previews as actively being built. Link to roadmap proposals 20 and 21. Do not provide share actions or claim availability.

- [ ] **Step 5: Verify responsive and accessible presentation**

Check desktop and mobile widths, text overflow, focus order, landmarks, reduced motion, image alt text, contrast, and that no nested cards or generic feature-pill wall was introduced.

### Task 3: Update Metadata And Discovery

**Files:**
- Modify: existing metadata and social-preview files under `apps/web/`
- Modify: existing sitemap generation file under `apps/web/`
- Test: matching metadata/deployment tests

**Interfaces:**
- Consumes: updated page content.
- Produces: accurate search and link-preview representations.

- [ ] **Step 1: Add failing metadata assertions**

Require current SQLite, Registry, Agent, multi-project, and secure self-hosting language; require `/roadmap` in the sitemap; reject Lowdb and built-in-authentication-planned copy.

- [ ] **Step 2: Update page metadata and social assets**

Use concise product language and current visual assets. Do not mention LabGD as shipped in the title, primary description, or social image.

- [ ] **Step 3: Run full website checks**

```bash
bun run test
bun run build
bun run test:deployment
```

Expected: all pass with no broken links, missing assets, or policy failures.

### Task 4: Deploy The Accurate Pre-Ship Website

**Files:**
- Use: `scripts/backup-roadmap.sh`
- Verify: `docs/roadmap-operations.md`

**Interfaces:**
- Consumes: verified website build.
- Produces: current website while LabGD remains in progress.

- [ ] **Step 1: Create and verify the matched roadmap backup**

Run the established SkyBolt website/roadmap backup workflow and record the exact backup path. Do not connect directly to SkyArk.

- [ ] **Step 2: Deploy the verified website commit**

Preserve PostgreSQL container identity and data. Recreate only the services required by the existing deployment workflow.

- [ ] **Step 3: Verify live behavior**

Confirm homepage, roadmap, health, readiness, GitHub OAuth start, proposal detail, responsive navigation, metadata, sitemap, screenshots, console errors `0`, and failed requests `0`.

- [ ] **Step 4: Record the pre-ship receipt**

Record commit, backup path, container IDs/start times, checks, public URLs, roadmap counts, and explicit confirmation that proposals 20 and 21 remain `in_progress`.
