import { randomUUID } from 'node:crypto'

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export class ApplicationLiveEventBus {
  constructor({ generationId = randomUUID(), now = () => new Date().toISOString(), maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES } = {}) {
    this.generationId = generationId
    this.now = now
    this.maxPayloadBytes = maxPayloadBytes
    this.sequence = 0
    this.globalTopicSequences = new Map()
    this.scopedTopicSequences = new WeakMap()
    this.listeners = new Set()
    this.closed = false
  }

  snapshot({ scope = null, topics = [] } = {}) {
    const scoped = scope && typeof scope === 'object' ? this.scopedTopicSequences.get(scope) : null
    const topicSequences = Object.fromEntries(topics.map((topic) => [
      topic,
      Math.max(this.globalTopicSequences.get(topic) ?? 0, scoped?.get(topic) ?? 0),
    ]))
    return Object.freeze({
      version: 1,
      generationId: this.generationId,
      sequence: this.sequence,
      topicSequences: Object.freeze(topicSequences),
    })
  }

  subscribe(listener) {
    if (this.closed) throw new Error('Application live event bus is closed.')
    if (typeof listener !== 'function') throw new TypeError('Application live event listener must be a function.')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish({ scope = null, topics, kind, payload = {} }) {
    if (this.closed) return null
    const normalizedTopics = [...new Set(Array.isArray(topics) ? topics : [topics])].filter((topic) => typeof topic === 'string' && topic.length > 0).sort()
    if (normalizedTopics.length === 0) throw new Error('Application live event requires at least one topic.')
    if (typeof kind !== 'string' || kind.length === 0) throw new Error('Application live event kind is required.')
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload))
    if (payloadBytes > this.maxPayloadBytes) throw new Error('Application live event payload exceeds the size limit.')
    this.sequence += 1
    const topicSequences = scope === null
      ? this.globalTopicSequences
      : this.scopedTopicSequences.get(scope) ?? new Map()
    if (scope !== null && !this.scopedTopicSequences.has(scope)) this.scopedTopicSequences.set(scope, topicSequences)
    for (const topic of normalizedTopics) topicSequences.set(topic, this.sequence)
    const event = Object.freeze({
      version: 1,
      generationId: this.generationId,
      sequence: this.sequence,
      topics: Object.freeze(normalizedTopics),
      kind,
      occurredAt: this.now(),
      payload: deepFreeze(structuredClone(payload)),
    })
    const internal = { scope, event }
    for (const listener of [...this.listeners]) {
      try { listener(internal) } catch {}
    }
    return event
  }

  close() {
    this.closed = true
    this.listeners.clear()
  }
}
