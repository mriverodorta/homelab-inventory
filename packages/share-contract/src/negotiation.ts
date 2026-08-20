export interface ShareCapabilities {
  contractVersion: number
  views: Readonly<Record<string, number>>
  features: readonly string[]
}

export type ShareNegotiationResult =
  | { ok: true }
  | {
    ok: false
    code: 'unsupported-contract'
    clientVersion: number
    serverVersion: number
  }
  | {
    ok: false
    code: 'unsupported-view'
    viewType: string
  }
  | {
    ok: false
    code: 'unsupported-view-version'
    viewType: string
    clientVersion: number
    serverVersion: number
  }
  | {
    ok: false
    code: 'unsupported-feature'
    feature: string
  }

export function negotiateShareCapabilities(
  client: ShareCapabilities,
  server: ShareCapabilities,
): ShareNegotiationResult {
  if (client.contractVersion !== server.contractVersion) {
    return {
      ok: false,
      code: 'unsupported-contract',
      clientVersion: client.contractVersion,
      serverVersion: server.contractVersion,
    }
  }

  for (const [viewType, clientVersion] of Object.entries(client.views).sort(([a], [b]) => a.localeCompare(b))) {
    const serverVersion = server.views[viewType]
    if (serverVersion === undefined) return { ok: false, code: 'unsupported-view', viewType }
    if (clientVersion !== serverVersion) {
      return {
        ok: false,
        code: 'unsupported-view-version',
        viewType,
        clientVersion,
        serverVersion,
      }
    }
  }

  const serverFeatures = new Set(server.features)
  for (const feature of client.features) {
    if (!serverFeatures.has(feature)) return { ok: false, code: 'unsupported-feature', feature }
  }

  return { ok: true }
}
