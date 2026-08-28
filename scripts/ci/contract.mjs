export const CI_CONTRACT_VERSION = 3
export const PINNED_BUN_VERSION = '1.3.14'
export const PINNED_RUST_VERSION = '1.94.1'

const RUST_VERIFICATION_INPUTS = Object.freeze(['rust', 'rust-toolchain.toml'])

export const CI_PHASES = Object.freeze([
  { id: 'install', command: ['bun', 'install', '--frozen-lockfile'] },
  { id: 'agent-pin', command: ['bun', 'run', 'check:agent-release'] },
  { id: 'release-notes', command: ['bun', 'run', 'release-notes:check'] },
  { id: 'rust-format', command: ['cargo', 'fmt', '--manifest-path', 'rust/Cargo.toml', '--all', '--', '--check'], cacheInputs: RUST_VERIFICATION_INPUTS },
  { id: 'rust-clippy', command: ['cargo', 'clippy', '--manifest-path', 'rust/Cargo.toml', '--workspace', '--all-targets', '--', '-D', 'warnings'], cacheInputs: RUST_VERIFICATION_INPUTS },
  { id: 'rust-test', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--workspace'], cacheInputs: RUST_VERIFICATION_INPUTS },
  { id: 'release-artifacts', command: ['bun', 'run', 'prepare:release-artifacts'] },
  { id: 'lint', command: ['bun', 'run', 'lint'] },
  { id: 'test', command: ['bun', 'run', 'test'], env: { HOMELAB_WASM_PREBUILT: '1' } },
  { id: 'build', command: ['bun', 'run', 'build'], env: { HOMELAB_WASM_PREBUILT: '1' } },
  { id: 'benchmark', command: ['bun', 'run', 'benchmark:engine'] },
])

export const CI_CONTRACT_FILES = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/codeql-scheduled.yml',
  '.github/workflows/docker-security-monitor.yml',
  '.githooks/pre-push',
  'package.json',
  'bun.lock',
  'rust-toolchain.toml',
  'rust/Cargo.toml',
  'rust/Cargo.lock',
  'scripts/ci/contract.mjs',
  'scripts/ci/phase-cache.mjs',
  'scripts/ci/receipt.mjs',
  'scripts/ci/run.mjs',
  'scripts/ci/verify-receipt.mjs',
  'scripts/release-artifacts/fingerprint.mjs',
  'scripts/release-artifacts/agent-store.mjs',
  'scripts/release-artifacts/store.mjs',
  'scripts/release-artifacts/prepare.mjs',
  'docker/agent-artifact.Dockerfile',
  'docker/wasm-artifact.Dockerfile',
  'Dockerfile',
  'scripts/local-release.mjs',
  'scripts/local-release/config.mjs',
])
