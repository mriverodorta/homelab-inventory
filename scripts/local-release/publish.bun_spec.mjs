import { describe, expect, test } from 'bun:test'
import {
  assertPublicationReady,
  candidateCleanupTags,
  candidateUploadCommand,
  indexCreateCommand,
  publicationPlan,
  publicationWritePlan,
} from './publish.mjs'

const identity = { branch: 'main', revision: 'a'.repeat(40), version: '0.12.4', sourceFingerprint: 'b'.repeat(64), trackedClean: true }
const candidate = { archive: '/candidate.oci.tar', digest: `sha256:${'c'.repeat(64)}` }

describe('exact artifact publication', () => {
  test('uploads an OCI layout by immutable digest without invoking a build', () => {
    const command = candidateUploadCommand({ oras: '/tools/oras', candidate, destination: 'docker.io/example/image:candidate' })
    expect(command).toEqual([
      '/tools/oras', 'cp', '--from-oci-layout', '--no-tty',
      `/candidate.oci.tar@${candidate.digest}`, 'docker.io/example/image:candidate',
    ])
    expect(command).not.toContain('build')
  })

  test('main moves latest while stable moves exact, minor, and stable tags', () => {
    expect(publicationPlan({ channel: 'latest', identity }).finalTags).toEqual([
      'docker.io/mriverodorta/homelab-inventory:latest',
    ])
    expect(publicationPlan({ channel: 'stable', identity }).finalTags).toEqual([
      'docker.io/mriverodorta/homelab-inventory:stable',
      'docker.io/mriverodorta/homelab-inventory:0.12.4',
      'docker.io/mriverodorta/homelab-inventory:0.12',
    ])
  })

  test('assembles one index from only the approved architecture uploads', () => {
    const plan = publicationPlan({ channel: 'latest', identity })
    const command = indexCreateCommand(plan)
    expect(command.at(-2)).toBe(plan.arm64)
    expect(command.at(-1)).toBe(plan.amd64)
    expect(command).not.toContain('build')
  })

  test('cleans remote candidates after publication but skips disposable dry runs', () => {
    const plan = publicationPlan({ channel: 'latest', identity })
    expect(candidateCleanupTags(plan, { dryRun: false })).toEqual([
      'candidate-aaaaaaaaaaaa-arm64',
      'candidate-aaaaaaaaaaaa-amd64',
    ])
    expect(candidateCleanupTags(plan, { dryRun: true })).toEqual([])
  })

  test('does not rewrite an existing matching immutable stable tag', () => {
    const plan = publicationPlan({ channel: 'stable', identity })
    const writePlan = publicationWritePlan(plan, { immutableTagExists: true })

    expect(writePlan.finalTags).toEqual([
      'docker.io/mriverodorta/homelab-inventory:stable',
      'docker.io/mriverodorta/homelab-inventory:0.12',
    ])
    expect(indexCreateCommand(writePlan)).not.toContain('docker.io/mriverodorta/homelab-inventory:0.12.4')
  })

  test('requires approval bound to the current ARM64 digest', () => {
    const state = {
      phase: 'approved', identity,
      candidates: { arm64: { digest: candidate.digest } },
      approval: { candidateDigest: candidate.digest },
    }
    expect(() => assertPublicationReady({ state, identity })).not.toThrow()
    expect(() => assertPublicationReady({
      state: { ...state, approval: { candidateDigest: 'different' } }, identity,
    })).toThrow('no longer matches')
  })
})
