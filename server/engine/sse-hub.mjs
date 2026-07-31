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
  constructor({ heartbeatMs = 25_000, maxClients = 256, maxClientsPerStore = 16 } = {}) {
    this.heartbeatMs = heartbeatMs
    this.maxClients = maxClients
    this.maxClientsPerStore = maxClientsPerStore
    this.clientCount = 0
    this.channels = new WeakMap()
    this.activeChannels = new Set()
  }

  channelFor(store) {
    const existing = this.channels.get(store)
    if (existing) return existing

    const clients = new Map()
    const unsubscribe = store.subscribeToProjectCommits((commit) => {
      const event = encodeEvent(commit)
      for (const [response, close] of clients) {
        try {
          writeEvent(response, event)
        } catch {
          close()
        }
      }
    })
    const channel = { clients, store, unsubscribe }
    this.channels.set(store, channel)
    this.activeChannels.add(channel)
    return channel
  }

  connect(store, request, response) {
    const channel = this.channelFor(store)
    if (this.clientCount >= this.maxClients || channel.clients.size >= this.maxClientsPerStore) {
      if (channel.clients.size === 0) {
        channel.unsubscribe()
        this.channels.delete(store)
        this.activeChannels.delete(channel)
      }
      response.status(503).json({
        message: 'Workspace event stream capacity has been reached. Try again shortly.',
        code: 'event-stream-capacity',
      })
      return null
    }
    response.status(200)
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    })
    let closed = false
    let heartbeat
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      channel.clients.delete(response)
      this.clientCount -= 1
      if (channel.clients.size === 0) {
        channel.unsubscribe()
        this.channels.delete(store)
        this.activeChannels.delete(channel)
      }
    }
    channel.clients.set(response, close)
    this.clientCount += 1
    request.once('close', close)
    response.once?.('error', close)
    try {
      response.flushHeaders?.()
      response.write(': connected\n\n')
    } catch {
      close()
      return null
    }
    heartbeat = setInterval(() => {
      try {
        response.write(': heartbeat\n\n')
      } catch {
        close()
      }
    }, this.heartbeatMs)
    heartbeat.unref?.()
    return close
  }

  closeAll() {
    let closedClients = 0
    for (const channel of [...this.activeChannels]) {
      for (const [response, close] of [...channel.clients]) {
        closedClients += 1
        try {
          response.end?.()
        } catch {}
        close()
      }
    }
    return closedClients
  }
}
