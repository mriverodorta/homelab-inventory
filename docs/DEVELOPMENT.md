# Development

## Requirements

- Bun 1.1 or newer
- Rust 1.94.1 with the `wasm32-unknown-unknown` target for domain-engine development
- Docker, only if building images locally
- Binaryen is optional locally and required only when producing an optimized WASM artifact

## Setup

```bash
bun install
bun run dev
```

Open:

```txt
http://127.0.0.1:5173
```

The development server uses `./data`. If that directory is empty, local development can seed fictional sample data from `server/seed`.

## Rust/WASM Development

Install the pinned toolchain target once:

```bash
rustup target add wasm32-unknown-unknown --toolchain 1.94.1
```

Run the app with the shared domain engine:

```bash
bun run dev:wasm
```

The command builds the Rust engine and loads the same WASM module in the browser worker and Bun server. It uses the ignored local `./data` directory by default and honors an explicitly supplied `DATA_DIR` when a separate development database is needed.

Generated `.wasm` files and local runtime data are intentionally untracked. Run `bun run build:wasm` after changing Rust protocol or engine code. Set `WASM_OPTIMIZE=1` when Binaryen is installed and an optimized local artifact is needed.

The worker exclusively owns canvas geometry, cable routing, endpoint indexing and occupancy, compatible-destination filtering, connection validation and commands, negotiated network speeds, network traces, and power-topology findings. React reads revision-scoped results through TanStack Query and retains only presentation concerns such as labels, card layout, and rendering. Do not add a TypeScript computational fallback for these domains; an unavailable engine must produce an explicit disabled or recovery state.

`bun run benchmark:engine` uses generated synthetic topology and records engine indexing, endpoint catalogs, compatibility filtering, connection validation and commands, negotiated state, network traces, power topology, binary protocol, project patches, cold cable plans, cached cable plans, and targeted cable recalculation under `artifacts/engine-benchmarks/`. The artifact directory is ignored locally and uploaded by CI for regression comparison.

## Scripts

```bash
bun run lint
bun run test
bun run test:watch
bun run build
bun run build:wasm
bun run check:wasm
bun run benchmark:engine
bun run security:container
bun run start
```

Install the versioned Git hooks once per checkout:

```bash
bun run hooks:install
```

Pushes to `main` or `stable` require a current local release receipt. When no receipt matches the exact revision, the pre-push hook falls back to `bun run security:container`. Both paths boot the distroless production image for `linux/amd64` and `linux/arm64` and require Docker Scout and Trivy to report zero known vulnerabilities at every severity. Docker Desktop must be running and Docker Scout must be available.

## Local Staged Releases

Docker release construction and publication run on the maintainer's Mac. GitHub Actions still validates source and monitors published images, but it does not build or write Docker tags.

```bash
bun run release:local warm-cache
bun run release:local prepare
```

`prepare` obtains a consistent read-only snapshot from `bolt`, incrementally transfers it with rsync into private state outside the repository, removes authentication, identities, credentials, Agent bindings, notification delivery, Registry contribution state, backup archives, and every outbound side effect, then builds and scans only the native ARM64 candidate. The exact candidate runs at `http://127.0.0.1:8799` as `homelab-inventory-staging` with `APP_MODE=staging` and a loopback-only port.

After testing the staging app:

```bash
bun run release:local approve
bun run release:local publish --channel latest --dry-run
bun run release:local publish --channel latest
```

Approval binds the Git revision, source fingerprint, sanitized snapshot, ARM64 OCI digest, running container, and post-start data fingerprint. Publication then builds and scans AMD64 once, uploads the exact tested OCI archives without rebuilding, assembles the multi-platform index, verifies it, and removes the temporary architecture candidate tags. Run from `stable` with `--channel stable` to move `stable`, create immutable `X.Y.Z`, update `X.Y`, and finalize the matching Git tag and GitHub Release.

Useful recovery commands:

```bash
bun run release:local status
bun run release:local logs
bun run release:local stop
bun run release:local reset
bun run release:local cleanup-candidates
```

Release state, staging data, OCI archives, receipts, and tools live under `~/Library/Application Support/Homelab Inventory Release`. Reusable BuildKit cache lives under `~/Library/Caches/homelab-inventory-release`. Both survive `~/bin/dclaim`; Docker images and the dedicated builder can be restored with `warm-cache`. None of these paths may be committed.

## Project Shape

```txt
src/
  components/      React components
  components/ui/   shadcn/ui primitives
  engine/          Browser domain-engine client and patch adapters
  lib/             client-side domain logic
  types/           shared TypeScript types
  workers/         Dedicated browser domain-engine worker
server/
  index.mjs        Express server and API routes
  agent-routes.mjs Linux agent enrollment and ingest API
  db/              API validation and legacy compatibility helpers
  persistence/     SQLite schemas, migrations, repositories, and projections
  engine/          Bun WASM authority and committed-event transport
  seed/            fictional development seed data
rust/
  crates/          Shared protocol, deterministic core, and raw WASM ABI
shared/engine/     MessagePack protocol and WASM byte runtime
data/              local runtime data, gitignored
```

## Before Opening A Pull Request

Run:

```bash
bun run lint
bun run test
bun run build
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path rust/Cargo.toml --workspace
bun run security:container
```

Keep public examples and seed files fictional. Do not commit real inventory, LAN IPs, Tailscale IPs, serial numbers, tokens, or agent status.
