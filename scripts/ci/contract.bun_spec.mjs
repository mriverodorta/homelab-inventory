import { describe, expect, test } from 'bun:test'
import { CI_CONTRACT_FILES, CI_CONTRACT_VERSION, CI_PHASES } from './contract.mjs'

describe('local CI contract', () => {
  test('matches every GitHub validation phase in fail-fast order', () => {
    expect(CI_CONTRACT_VERSION).toBe(3)
    expect(CI_PHASES).toEqual([
      { id: 'install', command: ['bun', 'install', '--frozen-lockfile'] },
      { id: 'agent-pin', command: ['bun', 'run', 'check:agent-release'] },
      { id: 'release-notes', command: ['bun', 'run', 'release-notes:check'] },
      { id: 'rust-format', command: ['cargo', 'fmt', '--manifest-path', 'rust/Cargo.toml', '--all', '--', '--check'], cacheInputs: ['rust', 'rust-toolchain.toml'] },
      { id: 'rust-clippy', command: ['cargo', 'clippy', '--manifest-path', 'rust/Cargo.toml', '--workspace', '--all-targets', '--', '-D', 'warnings'], cacheInputs: ['rust', 'rust-toolchain.toml'] },
      { id: 'rust-test', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--workspace'], cacheInputs: ['rust', 'rust-toolchain.toml'] },
      { id: 'release-artifacts', command: ['bun', 'run', 'prepare:release-artifacts'] },
      { id: 'lint', command: ['bun', 'run', 'lint'] },
      { id: 'test', command: ['bun', 'run', 'test'], env: { HOMELAB_WASM_PREBUILT: '1' } },
      { id: 'build', command: ['bun', 'run', 'build'], env: { HOMELAB_WASM_PREBUILT: '1' } },
      { id: 'benchmark', command: ['bun', 'run', 'benchmark:engine'] },
    ])
  })

  test('fingerprints every file capable of changing protected validation', () => {
    expect(CI_CONTRACT_FILES).toEqual(expect.arrayContaining([
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
    ]))
  })
})
