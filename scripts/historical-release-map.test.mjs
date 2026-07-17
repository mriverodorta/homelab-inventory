import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  HISTORICAL_RELEASE_MAP,
  formatHistoricalReleaseOutput,
  getHistoricalRelease,
  parseHistoricalReleaseArguments,
  validateFullRevision,
  validateHistoricalRelease,
} from './historical-release-map.mjs'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'historical-release-map.mjs')
const temporaryDirectories = []

const expectedReleases = [
  ['0.1.10', '57c3cb280f8c32e766d967429cbc29a071b952c4'],
  ['0.1.11', '9753e65689321b94404360b0f6dfde8a9cc3ccf5'],
  ['0.1.12', 'cec20d794e72fa37ce3fdb19396983a9a628825c'],
  ['0.1.13', '292175b59b84aca2a98e2789bfc892901c455e1e'],
  ['0.1.14', 'bd63db4731bf68feec1c4d6e09af3bb630e7eedc'],
  ['0.1.15', 'a68d8ab6caad2bd208b6ed27b4c0435b6e79ee6d'],
  ['0.1.16', '1dfb3aafb68d46b7f12bd0da08d764cba09c97a3'],
  ['0.1.17', '02ff99c215ee09a53b814a4b7b23e05c4157f7c4'],
  ['0.1.18', '0e1a85b3828626067247b1f6644b197de2eec220'],
  ['0.1.19', 'a41f8bc79bcb2aab12a687ad4929c5d697b34817'],
  ['0.1.20', '6612ed277563ea3067ad34fe8c8710a65c3c7105'],
]

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('HISTORICAL_RELEASE_MAP', () => {
  test('contains exactly the bounded 0.1.10 through 0.1.20 releases', () => {
    expect(Object.entries(HISTORICAL_RELEASE_MAP)).toEqual(expectedReleases)
  })

  test('is immutable', () => {
    expect(Object.isFrozen(HISTORICAL_RELEASE_MAP)).toBe(true)
  })
})

describe('validateFullRevision', () => {
  test('accepts and canonicalizes a full Git SHA', () => {
    expect(validateFullRevision('A41F8BC79BCB2AAB12A687AD4929C5D697B34817')).toBe(
      'a41f8bc79bcb2aab12a687ad4929c5d697b34817',
    )
  })

  test.each([
    '',
    'a41f8bc',
    'a41f8bc79bcb2aab12a687ad4929c5d697b3481',
    'a41f8bc79bcb2aab12a687ad4929c5d697b348170',
    'g41f8bc79bcb2aab12a687ad4929c5d697b34817',
    'a41f8bc79bcb2aab12a687ad4929c5d697b34817 ',
  ])('rejects non-full SHA %j', (revision) => {
    expect(() => validateFullRevision(revision)).toThrow('Expected a full 40-character Git SHA')
  })
})

describe('getHistoricalRelease', () => {
  test.each(expectedReleases)('returns canonical metadata for %s', (version, revision) => {
    expect(getHistoricalRelease(version)).toEqual({
      version,
      revision,
      gitTag: `v${version}`,
      minorTag: '0.1',
    })
  })

  test.each(['0.1.9', '0.1.21', 'v0.1.10', '0.1.10-beta.1', '']) (
    'rejects unsupported version %j',
    (version) => expect(() => getHistoricalRelease(version)).toThrow('Unsupported historical release version'),
  )
})

describe('validateHistoricalRelease', () => {
  test.each(expectedReleases)('accepts the authoritative mapping for %s', (version, revision) => {
    expect(validateHistoricalRelease({ version, revision })).toEqual(getHistoricalRelease(version))
  })

  test('rejects a full but mismatched revision', () => {
    expect(() => validateHistoricalRelease({
      version: '0.1.10',
      revision: HISTORICAL_RELEASE_MAP['0.1.11'],
    })).toThrow('refusing mismatched revision')
  })

  test('rejects malformed revisions before comparing the mapping', () => {
    expect(() => validateHistoricalRelease({ version: '0.1.10', revision: '57c3cb2' })).toThrow(
      'Expected a full 40-character Git SHA',
    )
  })
})

describe('parseHistoricalReleaseArguments', () => {
  test('accepts either argument order', () => {
    expect(parseHistoricalReleaseArguments([
      '--revision', HISTORICAL_RELEASE_MAP['0.1.10'],
      '--version', '0.1.10',
    ])).toEqual({
      revision: HISTORICAL_RELEASE_MAP['0.1.10'],
      version: '0.1.10',
    })
  })

  test.each([
    [[], 'Missing required --version'],
    [['--version', '0.1.10'], 'Missing required --revision'],
    [['--revision', HISTORICAL_RELEASE_MAP['0.1.10']], 'Missing required --version'],
    [['version', '0.1.10'], 'Invalid argument'],
    [['--version'], 'Invalid argument'],
    [['--unknown', 'value'], 'Unknown argument'],
    [['--version', '0.1.10', '--version', '0.1.10'], 'Duplicate argument'],
  ])('rejects invalid arguments %j', (args, message) => {
    expect(() => parseHistoricalReleaseArguments(args)).toThrow(message)
  })
})

describe('formatHistoricalReleaseOutput', () => {
  test('emits GitHub Actions-compatible canonical output', () => {
    expect(formatHistoricalReleaseOutput(getHistoricalRelease('0.1.10'))).toBe(
      [
        'version=0.1.10',
        `revision=${HISTORICAL_RELEASE_MAP['0.1.10']}`,
        'git_tag=v0.1.10',
        'minor_tag=0.1',
        '',
      ].join('\n'),
    )
  })
})

describe('historical release map CLI', () => {
  test('writes canonical output to stdout', () => {
    const { GITHUB_OUTPUT: _githubOutput, ...env } = process.env
    const output = execFileSync('bun', [
      scriptPath,
      '--version', '0.1.19',
      '--revision', HISTORICAL_RELEASE_MAP['0.1.19'],
    ], { encoding: 'utf8', env })

    expect(output).toBe(formatHistoricalReleaseOutput(getHistoricalRelease('0.1.19')))
  })

  test('appends canonical output to GITHUB_OUTPUT instead of stdout', () => {
    const directory = mkdtempSync(join(tmpdir(), 'historical-release-map-'))
    temporaryDirectories.push(directory)
    const outputPath = join(directory, 'github-output.txt')
    const result = spawnSync('bun', [
      scriptPath,
      '--version', '0.1.18',
      '--revision', HISTORICAL_RELEASE_MAP['0.1.18'],
    ], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(readFileSync(outputPath, 'utf8')).toBe(formatHistoricalReleaseOutput(getHistoricalRelease('0.1.18')))
  })

  test.each([
    ['0.1.21', HISTORICAL_RELEASE_MAP['0.1.20'], 'Unsupported historical release version'],
    ['0.1.19', 'a41f8bc', 'Expected a full 40-character Git SHA'],
    ['0.1.19', HISTORICAL_RELEASE_MAP['0.1.18'], 'refusing mismatched revision'],
  ])('fails without output for invalid mapping %s', (version, revision, message) => {
    const result = spawnSync('bun', [
      scriptPath,
      '--version', version,
      '--revision', revision,
    ], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(message)
  })
})
