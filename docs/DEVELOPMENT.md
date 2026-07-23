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

Run the shared domain engine with isolated development data:

```bash
bun run dev:wasm
```

The command builds the Rust engine, loads the same WASM module in the browser worker and Bun server, and forces `DATA_DIR` to `./data-wasm`. Create `data-wasm/` as an explicit copy of local development data before starting. Required-WASM mode refuses to use the repository `data/` directory so migration work cannot modify the normal development database.

Generated `.wasm` files and `data-wasm/` are intentionally untracked. Run `bun run build:wasm` after changing Rust protocol or engine code. Set `WASM_OPTIMIZE=1` when Binaryen is installed and an optimized local artifact is needed.

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
  workers/         Background domain and cable-routing workers
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
data-wasm/         isolated WASM development data, gitignored
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
