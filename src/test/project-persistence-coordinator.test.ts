import { describe, expect, it, vi } from 'vitest'
import { ProjectPersistenceCoordinator } from '@/lib/project-persistence-coordinator'

describe('ProjectPersistenceCoordinator', () => {
  it('settles legacy persistence before running the engine mutation', async () => {
    const events: string[] = []
    const coordinator = new ProjectPersistenceCoordinator()

    const result = await coordinator.run(
      async () => { events.push('legacy-save') },
      async () => {
        events.push('engine-command')
        return 22
      },
    )

    expect(result).toBe(22)
    expect(events).toEqual(['legacy-save', 'engine-command'])
  })

  it('serializes callers and reports activity only for the duration of queued work', async () => {
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const events: string[] = []
    const activity = vi.fn()
    const coordinator = new ProjectPersistenceCoordinator(activity)

    const first = coordinator.run(
      async () => { events.push('settle-first') },
      async () => {
        events.push('mutate-first')
        await firstGate
      },
    )
    const second = coordinator.run(
      async () => { events.push('settle-second') },
      async () => { events.push('mutate-second') },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['settle-first', 'mutate-first'])
    expect(activity).toHaveBeenLastCalledWith(true)

    releaseFirst()
    await Promise.all([first, second])

    expect(events).toEqual([
      'settle-first',
      'mutate-first',
      'settle-second',
      'mutate-second',
    ])
    expect(activity).toHaveBeenLastCalledWith(false)
  })
})
