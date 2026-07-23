function encodeEvent(event) {
  if (event.type === 'project-commit') {
    return {
      name: 'project-patch',
      id: event.revision,
      data: {
        baseRevision: event.baseRevision,
        revision: event.revision,
        payload: Buffer.from(event.responseBytes).toString('base64'),
      },
    }
  }

  return {
    name: 'project-invalidated',
    id: event.revision,
    data: {
      baseRevision: event.baseRevision,
      revision: event.revision,
    },
  }
}

function writeEvent(response, event) {
  response.write(`id: ${String(event.id)}\n`)
  response.write(`event: ${event.name}\n`)
  response.write(`data: ${JSON.stringify(event.data)}\n\n`)
}

export class EngineSseHub {
  constructor({ heartbeatMs = 25_000 } = {}) {
    this.heartbeatMs = heartbeatMs
    this.channels = new WeakMap()
  }

  channelFor(store) {
    const existing = this.channels.get(store)
    if (existing) return existing

    const clients = new Set()
    const unsubscribe = store.subscribeToProjectCommits((commit) => {
      const event = encodeEvent(commit)
      for (const response of clients) writeEvent(response, event)
    })
    const channel = { clients, unsubscribe }
    this.channels.set(store, channel)
    return channel
  }

  connect(store, request, response) {
    const channel = this.channelFor(store)
    response.status(200)
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    })
    response.flushHeaders?.()
    response.write(': connected\n\n')
    channel.clients.add(response)

    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), this.heartbeatMs)
    heartbeat.unref?.()

    const close = () => {
      clearInterval(heartbeat)
      channel.clients.delete(response)
      if (channel.clients.size === 0) {
        channel.unsubscribe()
        this.channels.delete(store)
      }
    }
    request.once('close', close)
    return close
  }
}
