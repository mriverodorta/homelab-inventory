import { describe, expect, test } from 'bun:test'
import {
  createApproval,
  probeStagingRuntime,
  stagingIngressRunCommand,
  stagingRunCommand,
} from './staging.mjs'

const candidate = {
  platform: 'linux/arm64',
  image: 'homelab-inventory-candidate:abc-arm64',
  digest: `sha256:${'a'.repeat(64)}`,
  revision: 'b'.repeat(40),
  sourceFingerprint: 'c'.repeat(64),
}

describe('local release staging', () => {
  test('keeps the staged application on the outbound-isolated network', () => {
    const command = stagingRunCommand(candidate, { currentDataDir: '/private/staging data/current' })
    expect(command).toContain(candidate.image)
    expect(command).not.toContain('--publish')
    expect(command).toContain('type=bind,source=/private/staging data/current,target=/data')
    expect(command).toContain('homelab-inventory-staging-isolated')
    expect(command.filter((entry) => entry === '--network')).toHaveLength(1)
    expect(command).toContain('APP_MODE=staging')
    expect(command).toContain('UPDATE_CHECK_ENABLED=false')
    expect(command).toContain('REGISTRY_REFRESH_INTERVAL_MS=0')
    expect(command).toContain('LABGD_ENABLED=false')
    expect(command).toContain('REGISTRY_IDENTITY_ENABLED=false')
    expect(command).toContain('REGISTRY_CONTRIBUTION_ENABLED=false')
    expect(command).not.toContain('--privileged')
  })

  test('uses a loopback-only fixed-target ingress without attaching the app to an egress network', () => {
    const command = stagingIngressRunCommand(candidate)
    expect(command).toContain(candidate.image)
    expect(command).toContain('127.0.0.1:8799:8799')
    expect(command).toContain('homelab-inventory-staging-ingress')
    expect(command).toContain('--no-healthcheck')
    expect(command).toContain('--entrypoint')
    expect(command).toContain('bun')
    expect(command.at(-1)).toContain("targetOrigin = 'http://homelab-inventory-staging:8798'")
    expect(command.at(-1)).toContain("headers.set('accept-encoding', 'identity')")
    expect(command.at(-1)).toContain("responseHeaders.delete('content-encoding')")
    expect(command.at(-1)).not.toContain('request.headers.get')
    expect(command).not.toContain('--privileged')
  })

  test('binds approval to source, snapshot, image, and post-start data', () => {
    const identity = {
      revision: candidate.revision,
      sourceFingerprint: candidate.sourceFingerprint,
      trackedClean: true,
    }
    const approval = createApproval({
      identity,
      candidate,
      snapshot: { createdAt: '2026-08-13T00:00:00.000Z' },
      sanitizedData: { fingerprint: 'd'.repeat(64) },
      check: {
        candidateDigest: candidate.digest,
        dataFingerprint: 'e'.repeat(64),
        containerId: 'container',
        imageId: 'image',
      },
    })
    expect(approval.binding).toMatch(/^[a-f0-9]{64}$/)
    expect(approval.candidateDigest).toBe(candidate.digest)
  })

  test('rejects approval after source or candidate drift', () => {
    expect(() => createApproval({
      identity: { revision: 'different', sourceFingerprint: candidate.sourceFingerprint, trackedClean: true },
      candidate,
      snapshot: {},
      sanitizedData: {},
      check: { candidateDigest: candidate.digest },
    })).toThrow('no longer matches')
  })

  test('probes the staged shell, immutable asset, bootstrap, and SSE transport', async () => {
    const encoder = new TextEncoder()
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === '/api/health') return Response.json({ ok: true, mode: 'staging' })
      if (pathname === '/') {
        return new Response('<div id="root"></div><script src="/assets/app.js"></script>', {
          headers: { 'content-security-policy': "default-src 'self'" },
        })
      }
      if (pathname === '/assets/app.js') {
        return new Response('console.log("ready")', { headers: { 'cache-control': 'public, max-age=31536000, immutable' } })
      }
      if (pathname === '/api/bootstrap') return Response.json({ projects: [{ project: { id: 1 } }] })
      if (pathname === '/api/events') {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: stream-ready\ndata: {}\n\n'))
          },
        }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
      }
      return new Response(null, { status: 404 })
    }

    await expect(probeStagingRuntime({ baseUrl: 'http://staging.test', fetchImpl })).resolves.toMatchObject({
      assetPath: '/assets/app.js',
      projectCount: 1,
      sse: 'ready',
    })
  })
})
