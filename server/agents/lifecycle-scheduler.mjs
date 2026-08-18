import { agentStatusTiming } from './status-model.mjs'

function hostKey(host) { return `${host.hostType}:${host.hostId}` }

export class AgentLifecycleScheduler {
  constructor({ summary, onTransition, now = () => Date.now(), setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, timing = agentStatusTiming() }) {
    this.summary = summary
    this.onTransition = onTransition
    this.now = now
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.timing = timing
    this.hosts = new Map()
    this.timer = null
    this.running = false
  }

  start() {
    if (this.running) return
    this.running = true
    this.rebuild(false)
  }

  stop() {
    this.running = false
    if (this.timer) this.clearTimeoutFn(this.timer)
    this.timer = null
    this.hosts.clear()
  }

  changed(host) {
    if (!this.running) return
    this.refresh(host, false)
    this.arm()
  }

  rebuild(emit) {
    const current = this.summary(this.now())
    const registered = new Map((current.registeredHosts ?? []).map((host) => [hostKey(host), host]))
    for (const [key, host] of registered) {
      const status = current.hosts?.[key] ?? { ...host, state: 'unknown', connected: true, ageMs: null }
      const previous = this.hosts.get(key)
      this.hosts.set(key, { host, status })
      if (emit && previous && previous.status.state !== status.state) this.onTransition(host, status)
    }
    for (const key of [...this.hosts.keys()]) {
      if (!registered.has(key)) this.hosts.delete(key)
    }
    this.arm()
  }

  refresh(host, emit) {
    const key = hostKey(host)
    const current = this.summary(this.now())
    const registered = (current.registeredHosts ?? []).some((candidate) => hostKey(candidate) === key)
    const previous = this.hosts.get(key)
    if (!registered) {
      this.hosts.delete(key)
      if (emit && previous?.status.state !== 'unregistered') this.onTransition(host, { ...host, state: 'unregistered', connected: false, ageMs: null })
      return
    }
    const status = current.hosts?.[key] ?? { ...host, state: 'unknown', connected: true, ageMs: null }
    this.hosts.set(key, { host, status })
    if (emit && previous && previous.status.state !== status.state) this.onTransition(host, status)
  }

  deadline(status) {
    const seen = Date.parse(status.lastSeenAt ?? '')
    if (!Number.isFinite(seen)) return null
    if (status.state === 'online') return seen + this.timing.onlineMaxAgeMs + 1
    if (status.state === 'stale') return seen + this.timing.staleMaxAgeMs + 1
    return null
  }

  arm() {
    if (this.timer) this.clearTimeoutFn(this.timer)
    this.timer = null
    if (!this.running) return
    const deadlines = [...this.hosts.values()].map(({ status }) => this.deadline(status)).filter(Number.isFinite)
    if (deadlines.length === 0) return
    const delay = Math.max(0, Math.min(...deadlines) - this.now())
    this.timer = this.setTimeoutFn(() => {
      this.timer = null
      for (const { host } of [...this.hosts.values()]) this.refresh(host, true)
      this.arm()
    }, delay)
    this.timer?.unref?.()
  }
}

