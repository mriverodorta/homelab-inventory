import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { selectMonitorDigest } from './monitor-target.mjs'

const amd64 = { digest: `sha256:${'a'.repeat(64)}`, platform: { os: 'linux', architecture: 'amd64' } }
const arm64 = { digest: `sha256:${'b'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } }
const index = { manifests: [amd64, arm64, { digest: `sha256:${'c'.repeat(64)}`, platform: { os: 'unknown', architecture: 'unknown' } }] }
describe('scheduled image monitor', () => {
  test('selects exact runtime manifests, not multi-platform indexes or attestations', () => {
    expect(selectMonitorDigest(index, 'amd64')).toBe(amd64.digest)
    expect(selectMonitorDigest(index, 'arm64')).toBe(arm64.digest)
  })
  test('rejects missing, ambiguous, malformed or unsupported platform targets', () => {
    for (const value of [{}, { manifests: [] }, { manifests: [arm64, arm64] }, { manifests: [{ ...arm64, digest: 'invalid' }] }]) {
      expect(() => selectMonitorDigest(value, 'arm64')).toThrow()
    }
    expect(() => selectMonitorDigest(index, 's390x')).toThrow()
  })
  test('both scanners bypass the Docker export path and retain all-severity gates', () => {
    const action = Bun.YAML.parse(readFileSync(new URL('../../.github/actions/scan-runtime/action.yml', import.meta.url), 'utf8'))
    const [trivy, scout] = action.runs.steps
    expect(trivy.env.TRIVY_IMAGE_SRC).toBe('remote')
    expect(trivy.env.TRIVY_PLATFORM).toBe('${{ inputs.platform }}')
    expect(trivy.with['ignore-unfixed']).toBe(false)
    expect(trivy.with.severity).toBe('UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL')
    expect(trivy.with['exit-code']).toBe('1')
    expect(scout.with.image).toBe('registry://${{ inputs.image-ref }}')
    expect(scout.with['only-severities']).toBe('critical,high,medium,low,unspecified')
    expect(scout.with['exit-code']).toBe(true)
    expect(scout.if).toBe('${{ !cancelled() }}')
    const workflow = readFileSync(new URL('../../.github/workflows/docker-security-monitor.yml', import.meta.url), 'utf8')
    expect(workflow).toContain('steps.target.outputs.image-ref')
    expect(workflow).not.toContain('docker pull')
  })
})
