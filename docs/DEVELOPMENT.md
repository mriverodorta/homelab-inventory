# Development

## Requirements

- Bun 1.1 or newer
- Docker, only if building images locally

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

## Scripts

```bash
bun run lint
bun run test
bun run test:watch
bun run build
bun run start
```

## Project Shape

```txt
src/
  components/      React components
  components/ui/   shadcn/ui primitives
  lib/             client-side domain logic
  types/           shared TypeScript types
server/
  index.mjs        Express server and API routes
  agent-routes.mjs Linux agent enrollment and ingest API
  db/              lowdb stores, validation, token helpers
  seed/            fictional development seed data
data/              local runtime data, gitignored
```

## Before Opening A Pull Request

Run:

```bash
bun run lint
bun run test
bun run build
```

Keep public examples and seed files fictional. Do not commit real inventory, LAN IPs, Tailscale IPs, serial numbers, tokens, or agent status.
