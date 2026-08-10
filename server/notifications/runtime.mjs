import { NotificationDeliveryCoordinator } from './delivery-coordinator.mjs'
import { NotificationEvaluator } from './evaluator.mjs'
import { IncidentManager } from './incident-manager.mjs'
import { NotificationSecretVault } from './secret-vault.mjs'
import { NotificationStore } from './store.mjs'
import { resolveHostNotificationPolicy } from './policy-resolver.mjs'
import { pruneNotificationHistory } from './retention.mjs'

export function buildAgentMonitoringConfig(config, hostType, hostId) {
  const policy = resolveHostNotificationPolicy(config, hostType, hostId)
  const selectedServices = policy.resources.filter((resource) => resource.family === 'service').map((resource) => resource.key)
  const selectedContainers = policy.resources.filter((resource) => resource.family === 'container').map((resource) => resource.key)
  return {
    revision: config.revision,
    enabled: policy.enabled,
    serviceIntervalSeconds: selectedServices.length > 0 ? 60 : 600,
    selectedServices,
    selectedContainers,
  }
}

export async function createNotificationRuntime({ dataDir, workspaceStore, log = console }) {
  const store = await new NotificationStore({ dataDir }).init()
  const vault = await new NotificationSecretVault({ dataDir, store }).init()
  const incidentManager = new IncidentManager({ store })
  const evaluator = new NotificationEvaluator({ store, incidentManager })
  const deliveryCoordinator = new NotificationDeliveryCoordinator({ store, vault })
  let timer = null
  let retentionTimer = null
  let retentionFollowUpTimer = null

  const runRetention = async () => {
    try {
      const result = await pruneNotificationHistory(store)
      if (result.remaining && timer && !retentionFollowUpTimer) {
        retentionFollowUpTimer = setTimeout(() => {
          retentionFollowUpTimer = null
          void runRetention()
        }, 1_000)
        retentionFollowUpTimer.unref?.()
      }
    } catch (error) {
      log.error('[notifications] Retention cleanup failed.', error instanceof Error ? error.message : error)
    }
  }

  const evaluateHosts = async () => {
    try {
      if (!store.readConfig().enabled) return
      const project = workspaceStore.getProject()
      const summary = workspaceStore.getAgentStatusSummary()
      const hosts = Object.values(summary.hosts).map((status) => ({
        ...status,
        name: project.items?.[`${status.hostType}:${status.hostId}`]?.name,
      }))
      await evaluator.evaluateHostStatuses(hosts)
      await incidentManager.evaluateSuppressedOpenings()
      await incidentManager.evaluateRecoveries()
      await incidentManager.evaluateReminders()
      void deliveryCoordinator.wake()
    } catch (error) {
      log.error('[notifications] Host evaluation failed.', error instanceof Error ? error.message : error)
    }
  }

  return {
    store,
    vault,
    incidentManager,
    evaluator,
    deliveryCoordinator,
    start() {
      if (timer) return
      deliveryCoordinator.start()
      timer = setInterval(() => void evaluateHosts(), 15_000)
      timer.unref?.()
      retentionTimer = setInterval(() => void runRetention(), 3_600_000)
      retentionTimer.unref?.()
      void evaluateHosts()
      void runRetention()
    },
    async stop() {
      if (timer) clearInterval(timer)
      if (retentionTimer) clearInterval(retentionTimer)
      if (retentionFollowUpTimer) clearTimeout(retentionFollowUpTimer)
      timer = null
      retentionTimer = null
      retentionFollowUpTimer = null
      deliveryCoordinator.stop()
      await store.flush()
    },
    monitoringConfig(hostType, hostId) {
      return buildAgentMonitoringConfig(store.readConfig(), hostType, hostId)
    },
  }
}
