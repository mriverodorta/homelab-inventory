import { describe, expect, it } from 'bun:test'
import { StartupProfiler } from './startup-profiler.mjs'

describe('startup profiler', () => {
  it('reports ordered phase and total durations only when enabled', () => {
    const ticks = [100, 115, 152, 160]
    const logs = []
    const profiler = new StartupProfiler({
      enabled: true,
      clock: () => ticks.shift(),
      log: (value) => logs.push(value),
    })
    profiler.mark('persistence')
    profiler.mark('catalog')
    expect(profiler.complete()).toEqual({
      event: 'startup-profile',
      totalMs: 60,
      phases: [
        { name: 'persistence', durationMs: 15 },
        { name: 'catalog', durationMs: 37 },
      ],
    })
    expect(JSON.parse(logs[0])).toMatchObject({ event: 'startup-profile', totalMs: 60 })
  })

  it('is a silent no-op by default', () => {
    const logs = []
    const profiler = new StartupProfiler({ log: (value) => logs.push(value) })
    profiler.mark('catalog')
    expect(profiler.complete()).toBeNull()
    expect(logs).toEqual([])
  })
})
