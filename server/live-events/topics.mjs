const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])

function positiveId(value, label) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive integer.`)
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw new Error(`${label} must be a positive safe integer.`)
  return id
}

export function parseApplicationLiveTopic(value) {
  if (value === 'agents:fleet') return Object.freeze({ value, permission: 'agents.view', kind: 'agents-fleet' })
  if (value === 'notifications:summary') return Object.freeze({ value, permission: 'notifications.view', kind: 'notifications-summary' })
  if (value === 'notifications:incidents') return Object.freeze({ value, permission: 'notifications.view', kind: 'notifications-incidents' })
  if (value === 'updates:status') return Object.freeze({ value, permission: 'updates.view', kind: 'updates-status' })
  if (value === 'demo:session') return Object.freeze({ value, permission: 'workspace.view', kind: 'demo-session' })

  const systems = /^systems:([^:]+)$/.exec(value)
  if (systems) return Object.freeze({
    value,
    permission: 'project.view',
    permissions: Object.freeze(['project.view', 'agents.view']),
    kind: 'systems',
    projectId: positiveId(systems[1], 'Systems project ID'),
  })

  const host = /^(agent-telemetry|agent-hardware):([^:]+):([^:]+)$/.exec(value)
  if (host) {
    if (!HOST_TYPES.has(host[2])) throw new Error('Agent topic host type is unsupported.')
    return Object.freeze({
      value,
      permission: 'agents.view',
      kind: host[1],
      hostType: host[2],
      hostId: positiveId(host[3], 'Agent topic host ID'),
    })
  }

  throw new Error('Application live event topic is unsupported.')
}

export function parseApplicationLiveTopics(input, { maximum = 12 } = {}) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('At least one application live event topic is required.')
  if (input.length > 1_024) throw new Error('Application live event topics exceed the size limit.')
  const values = [...new Set(input.split(',').map((value) => value.trim()).filter(Boolean))].sort()
  if (values.length === 0) throw new Error('At least one application live event topic is required.')
  if (values.length > maximum) throw new Error(`No more than ${maximum} application live event topics may be requested.`)
  return Object.freeze(values.map(parseApplicationLiveTopic))
}
