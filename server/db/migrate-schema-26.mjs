export function migrateSchema25To26(agentsSource) {
  const agents = structuredClone(agentsSource ?? {})
  if (!agents.enrollments || typeof agents.enrollments !== 'object' || Array.isArray(agents.enrollments)) {
    throw new Error('agents.enrollments must be an object before schema 26 migration.')
  }
  if (!agents.devices || typeof agents.devices !== 'object' || Array.isArray(agents.devices)) {
    throw new Error('agents.devices must be an object before schema 26 migration.')
  }
  const hasSnapshots = 'hardwareSnapshots' in agents
  const hasEvents = 'hardwareEvents' in agents
  if (hasSnapshots !== hasEvents) {
    throw new Error('Schema 25 agents store contains an incomplete schema 26 hardware projection.')
  }
  if (hasSnapshots) {
    if (!agents.hardwareSnapshots || Array.isArray(agents.hardwareSnapshots) || Object.keys(agents.hardwareSnapshots).length > 0
      || !agents.hardwareEvents || Array.isArray(agents.hardwareEvents) || Object.keys(agents.hardwareEvents).length > 0) {
      throw new Error('Schema 25 agents store contains populated schema 26 hardware collections.')
    }
    return {
      agents,
      summary: { initializedHardwareSnapshots: 0, initializedHardwareEvents: 0 },
    }
  }
  return {
    agents: {
      ...agents,
      hardwareSnapshots: {},
      hardwareEvents: {},
    },
    summary: {
      initializedHardwareSnapshots: 0,
      initializedHardwareEvents: 0,
    },
  }
}
