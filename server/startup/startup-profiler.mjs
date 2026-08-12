import { performance } from 'node:perf_hooks'

export class StartupProfiler {
  constructor({ enabled = false, clock = () => performance.now(), log = console.log } = {}) {
    this.enabled = enabled
    this.clock = clock
    this.log = log
    this.startedAt = this.clock()
    this.previousAt = this.startedAt
    this.phases = []
  }

  mark(name) {
    if (!this.enabled) return
    const now = this.clock()
    this.phases.push({ name, durationMs: Number((now - this.previousAt).toFixed(2)) })
    this.previousAt = now
  }

  complete() {
    if (!this.enabled) return null
    const report = {
      event: 'startup-profile',
      totalMs: Number((this.clock() - this.startedAt).toFixed(2)),
      phases: this.phases,
    }
    this.log(JSON.stringify(report))
    return report
  }
}
