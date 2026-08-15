export const CI_CONTRACT_VERSION = 1
export const PINNED_BUN_VERSION = '1.3.14'
export const PINNED_RUST_VERSION = '1.94.1'

export const CI_PHASES = Object.freeze([
  { id: 'install', command: ['bun', 'install', '--frozen-lockfile'] },
  { id: 'agent-pin', command: ['bun', 'run', 'check:agent-release'] },
  { id: 'release-notes', command: ['bun', 'run', 'release-notes:check'] },
  { id: 'rust-format', command: ['cargo', 'fmt', '--manifest-path', 'rust/Cargo.toml', '--all', '--', '--check'] },
  { id: 'rust-clippy', command: ['cargo', 'clippy', '--manifest-path', 'rust/Cargo.toml', '--workspace', '--all-targets', '--', '-D', 'warnings'] },
  { id: 'rust-test', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--workspace'] },
  { id: 'wasm', command: ['bun', 'run', 'build:wasm'] },
  { id: 'lint', command: ['bun', 'run', 'lint'] },
  { id: 'test', command: ['bun', 'run', 'test'] },
  { id: 'build', command: ['bun', 'run', 'build'] },
  { id: 'benchmark', command: ['bun', 'run', 'benchmark:engine'] },
])

export const CI_CONTRACT_FILES = Object.freeze([
  '.github/workflows/ci.yml',
  '.githooks/pre-push',
  'package.json',
  'bun.lock',
  'rust-toolchain.toml',
  'rust/Cargo.toml',
  'rust/Cargo.lock',
  'scripts/ci/contract.mjs',
  'scripts/ci/receipt.mjs',
  'scripts/ci/run.mjs',
  'scripts/ci/verify-receipt.mjs',
  'scripts/local-release.mjs',
  'scripts/local-release/config.mjs',
])
