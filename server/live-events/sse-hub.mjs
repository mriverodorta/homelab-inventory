function writeEvent(response, name, id, data) {
  if (id !== null && id !== undefined) response.write(`id: ${String(id)}\n`)
  response.write(`event: ${name}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

export class ApplicationSseHub {
  constructor({ bus, heartbeatMs = 25_000, maxClients = 256, maxClientsPerScope = 16 } = {}) {
    if (!bus) throw new Error('Application SSE hub requires an event bus.')
    this.bus = bus
    this.heartbeatMs = heartbeatMs
    this.maxClients = maxClients
    this.maxClientsPerScope = maxClientsPerScope
    this.clients = new Set()
  }

  connect({ scope, topics, request, response }) {
    const scopedCount = [...this.clients].filter((client) => client.scope === scope).length
    if (this.clients.size >= this.maxClients || scopedCount >= this.maxClientsPerScope) {
      response.status(503).json({ message: 'Application event stream capacity has been reached. Try again shortly.', code: 'event-stream-capacity' })
      return null
    }
    response.status(200)
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    })
    let heartbeat = null
    let closed = false
    const topicValues = new Set(topics.map((topic) => topic.value))
    const client = { scope, topicValues, response, close: null }
    const close = () => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
      this.clients.delete(client)
    }
    client.close = close
    const unsubscribe = this.bus.subscribe(({ scope: eventScope, event }) => {
      if (eventScope !== null && eventScope !== scope) return
      const topic = event.topics.find((candidate) => topicValues.has(candidate))
      if (!topic) return
      try {
        writeEvent(response, 'app-event', event.sequence, { ...event, topic })
      } catch {
        close()
      }
    })
    this.clients.add(client)
    request.once('close', close)
    response.once?.('error', close)
    try {
      response.flushHeaders?.()
      response.write('retry: 3000\n\n')
      writeEvent(response, 'stream-ready', null, { ...this.bus.snapshot(), topics: [...topicValues] })
    } catch {
      close()
      return null
    }
    heartbeat = setInterval(() => {
      try { response.write(': heartbeat\n\n') } catch { close() }
    }, this.heartbeatMs)
    heartbeat.unref?.()
    return close
  }

  closeAll() {
    const count = this.clients.size
    for (const client of [...this.clients]) {
      try { client.response.end?.() } catch {}
      client.close()
    }
    return count
  }
}

