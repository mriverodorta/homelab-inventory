import { and, desc, eq, isNull } from 'drizzle-orm'
import { agentHostBindings, agentMonitoringPolicies, agents } from '../schema/index.ts'
import { assertPositiveId, parseJson, type RepositoryContext } from './repository-context.ts'

export function createAgentRepository({ db }: RepositoryContext) {
  function getActiveForHost(hostItemId: number) {
    const row = db.select({
      id: agents.id,
      publicKey: agents.publicKey,
      protocolMajor: agents.protocolMajor,
      agentVersion: agents.agentVersion,
      capabilitiesJson: agents.capabilitiesJson,
      lastSequence: agents.lastSequence,
      lastSeenAtMs: agents.lastSeenAtMs,
      revokedAtMs: agents.revokedAtMs,
      createdAtMs: agents.createdAtMs,
      bindingId: agentHostBindings.id,
      bindingState: agentHostBindings.state,
      boundAtMs: agentHostBindings.boundAtMs,
    }).from(agentHostBindings)
      .innerJoin(agents, eq(agents.id, agentHostBindings.agentId))
      .where(and(
        eq(agentHostBindings.hostItemId, assertPositiveId(hostItemId, 'Host item ID')),
        eq(agentHostBindings.state, 'active'),
      )).get()
    return row ? { ...row, capabilities: parseJson(row.capabilitiesJson, {}) } : null
  }

  function getCurrentPolicy(hostItemId: number) {
    const row = db.select().from(agentMonitoringPolicies)
      .where(eq(agentMonitoringPolicies.hostItemId, assertPositiveId(hostItemId, 'Host item ID')))
      .orderBy(desc(agentMonitoringPolicies.revision)).limit(1).get()
    return row ? { ...row, policy: parseJson(row.policyJson, {}) } : null
  }

  function advanceHeartbeat(agentId: number, sequence: number, seenAtMs: number) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Agent sequence must be positive.')
    const result = db.update(agents).set({ lastSequence: sequence, lastSeenAtMs: seenAtMs })
      .where(and(eq(agents.id, assertPositiveId(agentId, 'Agent ID')), isNull(agents.revokedAtMs))).run()
    if (result.changes !== 1) throw new Error(`Active agent ${agentId} was not found.`)
  }

  return { getActiveForHost, getCurrentPolicy, advanceHeartbeat }
}

export type AgentRepository = ReturnType<typeof createAgentRepository>
