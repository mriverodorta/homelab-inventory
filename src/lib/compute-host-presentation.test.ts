import { describe, expect, it } from 'vitest'
import { resolveComputeHostPresentation } from '@/lib/compute-host-presentation'

describe('resolveComputeHostPresentation', () => {
  it('uses the approved application-wide host icons', () => {
    expect(resolveComputeHostPresentation({ type: 'nas' }).iconKey).toBe('database')
    expect(resolveComputeHostPresentation({ type: 'pcBuild', hardwareClass: 'workstation' }).iconKey).toBe('monitor-cog')
    expect(resolveComputeHostPresentation({ type: 'pcBuild', usageRole: 'server' }).iconKey).toBe('server')
    expect(resolveComputeHostPresentation({ type: 'server' }).iconKey).toBe('server')
  })

  it('defaults PCs without a usage role to the PC presentation', () => {
    expect(resolveComputeHostPresentation({ type: 'pcBuild' })).toEqual({
      iconKey: 'monitor-cog',
      label: 'PC',
    })
  })
})
