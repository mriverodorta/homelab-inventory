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
bun run start
```

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
  db/              lowdb stores, validation, token helpers
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
```

Keep public examples and seed files fictional. Do not commit real inventory, LAN IPs, Tailscale IPs, serial numbers, tokens, or agent status.
