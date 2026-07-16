import { compareVersions, getReleaseNotesBetween } from '../src/release-notes.ts'
import {
  determineImageRelationship,
  normalizePersistedUpdateResult,
  UPDATE_CACHE_MS,
} from './update-checker.mjs'

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'registry-unavailable'
}

function isSuccessful(result) {
  return ['ahead', 'available', 'current'].includes(result?.state)
    && result.errorCode === null
    && typeof result.availableVersion === 'string'
    && typeof result.availableRevision === 'string'
    && typeof result.runningVersion === 'string'
    && typeof result.runningRevision === 'string'
    && typeof result.channel === 'string'
    && typeof result.updateAvailable === 'boolean'
    && Number.isFinite(Date.parse(result.checkedAt))
}

function unknownResult(checker, persistedResult, error) {
  return {
    state: 'unknown',
    channel: checker.channel,
    runningVersion: checker.runningVersion,
    runningRevision: checker.runningRevision,
    availableVersion: persistedResult?.availableVersion ?? null,
    availableRevision: persistedResult?.availableRevision ?? null,
    updateAvailable: persistedResult?.updateAvailable === true,
    checkedAt: persistedResult?.checkedAt ?? null,
    errorCode: errorCode(error),
  }
}

function disabledResult(checker) {
  return {
    state: 'disabled',
    channel: checker.channel,
    runningVersion: checker.runningVersion,
    runningRevision: checker.runningRevision,
    availableVersion: null,
    availableRevision: null,
    updateAvailable: false,
    checkedAt: null,
    errorCode: null,
  }
}

function getSkipIdentity({ availableRevision, availableVersion, runningVersion }) {
  if (availableVersion === null) return null

  try {
    return compareVersions(availableVersion, runningVersion) > 0
      ? availableVersion
      : `${availableVersion}@${availableRevision}`
  } catch {
    return null
  }
}

function buildStatus({ checker, result, store, releaseNotes }) {
  const availableVersion = result.availableVersion ?? null
  const availableRevision = result.availableRevision ?? null
  let relationship = 'current'
  let semanticUpdateAvailable = false
  try {
    if (availableVersion !== null) {
      relationship = determineImageRelationship({
        availableRevision,
        availableVersion,
        runningRevision: checker.runningRevision,
        runningVersion: checker.runningVersion,
      })
      semanticUpdateAvailable = compareVersions(availableVersion, checker.runningVersion) > 0
    }
  } catch {
    relationship = 'current'
    semanticUpdateAvailable = false
  }
  const updateAvailable = relationship === 'available'
  const skipIdentity = updateAvailable
    ? getSkipIdentity({ availableRevision, availableVersion, runningVersion: checker.runningVersion })
    : null
  const skipped = skipIdentity !== null && store.isUpdateVersionSkipped(skipIdentity)
  const entries = semanticUpdateAvailable && availableVersion
    ? getReleaseNotesBetween(releaseNotes, checker.runningVersion, availableVersion)
    : []

  return {
    enabled: checker.enabled,
    channel: checker.channel,
    runningVersion: checker.runningVersion,
    runningRevision: checker.runningRevision,
    availableVersion,
    availableRevision,
    updateAvailable,
    skipped,
    checkedAt: result.checkedAt ?? null,
    state: result.state === 'unknown' || result.state === 'disabled'
      ? result.state
      : relationship,
    errorCode: result.errorCode ?? null,
    entries,
  }
}

async function saveSuccessfulResult(store, result) {
  if (isSuccessful(result)) {
    await store.saveUpdateCheck(result)
  }
  return result
}

async function resolveStatusResult({ checker, store, force = false, backgroundIfStale = false }) {
  if (!checker.enabled) return disabledResult(checker)

  const metadata = store.getUpdateMetadata()
  const persistedResult = normalizePersistedUpdateResult(metadata.lastUpdateCheck, {
    channel: checker.channel,
    runningRevision: checker.runningRevision,
    runningVersion: checker.runningVersion,
  })
  const checkedAt = Date.parse(persistedResult?.checkedAt ?? '')
  const stale = persistedResult !== null
    && (!Number.isFinite(checkedAt) || checker.now() - checkedAt >= UPDATE_CACHE_MS)

  if (!force && backgroundIfStale && stale) {
    void checker.check({ force: true, persistedResult })
      .then((result) => saveSuccessfulResult(store, result))
      .catch(() => undefined)
    return persistedResult
  }

  try {
    const result = await checker.check({ force, persistedResult })
    if (result?.state === 'unknown') {
      return unknownResult(checker, persistedResult, { code: result.errorCode })
    }
    return await saveSuccessfulResult(store, result)
  } catch (error) {
    return unknownResult(checker, persistedResult, error)
  }
}

export function registerUpdateRoutes(app, { withStore, checker, releaseNotes }) {
  function respond(request, response, { force = false } = {}) {
    void withStore(request, response, async (store) => {
      const result = await resolveStatusResult({ checker, store, force, backgroundIfStale: !force })
      response.json(buildStatus({ checker, result, store, releaseNotes }))
    }, { message: 'Unable to check for updates.' })
  }

  app.get('/api/update-status', (request, response) => respond(request, response))
  app.post('/api/update-status/check', (request, response) => respond(request, response, { force: true }))

  app.post('/api/update-status/skip', (request, response) => {
    void withStore(request, response, async (store) => {
      const result = await resolveStatusResult({ checker, store })
      const status = buildStatus({ checker, result, store, releaseNotes })

      if (!status.updateAvailable || !status.availableVersion) {
        response.status(409).json({ message: 'No update is available to skip.' })
        return
      }

      const skipIdentity = getSkipIdentity(status)
      await store.skipUpdateVersion(skipIdentity)
      response.json({ ...status, skipped: true })
    }, { message: 'Unable to skip the available update.' })
  })

  app.delete('/api/update-status/skip', (request, response) => {
    void withStore(request, response, async (store) => {
      await store.clearSkippedUpdateVersion()
      const result = await resolveStatusResult({ checker, store })
      response.json(buildStatus({ checker, result, store, releaseNotes }))
    }, { message: 'Unable to clear the skipped update.' })
  })
}
