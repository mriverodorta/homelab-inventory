const PublicIdPattern = /^[A-Za-z0-9_-]{16,64}$/
const allowedKeys = new Set(['view', 'item', 'connection'])

export interface ShareDeepLink {
  viewId: string
  itemId: string | null
  connectionId: string | null
}

export function parseShareDeepLink(input: string | URLSearchParams): ShareDeepLink | null {
  const params = typeof input === 'string'
    ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
    : new URLSearchParams(input)

  for (const key of params.keys()) {
    if (!allowedKeys.has(key) || params.getAll(key).length !== 1) return null
  }

  const viewId = params.get('view')
  const itemId = params.get('item')
  const connectionId = params.get('connection')

  if (!viewId || !PublicIdPattern.test(viewId)) return null
  if (itemId && connectionId) return null
  if (itemId && !PublicIdPattern.test(itemId)) return null
  if (connectionId && !PublicIdPattern.test(connectionId)) return null

  return { viewId, itemId, connectionId }
}
