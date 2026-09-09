# Contributing

Thanks for helping improve Homelab Inventory.

## Development Setup

```bash
bun install
bun run dev
```

Open `http://127.0.0.1:5173`.

## Quality Checks

Before opening a pull request, run:

```bash
bun run lint
bun run test
bun run build
```

Before pushing a release branch, also run:

```bash
bun run hooks:install
bun run security:container
```

The container preflight is mandatory for `main` and `stable`. It smoke-tests and scans the final amd64 and arm64 distroless images with Docker Scout and Trivy, and it accepts no known vulnerabilities.

## Pull Requests

- Keep changes focused.
- For dependency updates, run `bun install` and commit `bun.lock` together with `package.json`, then verify `bun install --frozen-lockfile`. This also applies to Dependabot updates; do not disable frozen installation to make CI pass.
- Security overrides must pin a patched version and include compatibility tests for the dependency that consumes it. Recheck them when upgrading that parent dependency; the current `csv-parse` override protects Casbin until its own supported range includes the fix.
- Include tests for behavior changes when practical.
- Update docs when changing deployment, data, or user-facing workflows.
- Do not commit real homelab data, secrets, tokens, screenshots with private IPs, or local `/data` files.

## Code Style

- React components use TypeScript and Tailwind.
- UI primitives live under `src/components/ui`.
- Domain logic should stay in `src/lib` where possible.
- Runtime server code is plain ESM under `server`.

## Issues

When reporting a bug, include:

- App version or Docker tag.
- Browser and OS.
- Docker or bare-metal install details.
- Steps to reproduce.
- Expected and actual behavior.

Sanitize private device names, IPs, serial numbers, and tokens before posting.
