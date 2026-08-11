import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  INITIAL_APPLICATION_REQUEST_BUDGET,
  INITIAL_APPLICATION_REQUEST_COUNT,
} from '../src/lib/bootstrap-contract.ts'
import { activateSqliteRuntime } from '../server/persistence/runtime.ts'
import { hashLegacyData } from '../server/persistence/migration/crash-fixtures.ts'
import { readLatestLegacySnapshot } from '../server/persistence/legacy/snapshot-reader.ts'
import { legacySemanticSnapshot } from '../server/persistence/legacy/semantic-snapshot.ts'
import { sqliteSemanticSnapshot } from '../server/persistence/migration/core-verifier.ts'
import {
  authenticationCountsFromLegacy,
  authenticationCountsFromSqlite,
  canonicalJson,
  catalogIndexSummary,
  protectedIdentityHashes,
  telemetryCounts,
  topologyHash,
} from '../server/persistence/parity/report.ts'

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error('Usage: --source <data-dir> --output <empty-dir>.')
    values.set(key.slice(2), value)
  }
  if (!values.get('source') || !values.get('output')) throw new Error('Both --source and --output are required.')
  return { source: resolve(values.get('source')), output: resolve(values.get('output')) }
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function assertEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} parity failed.`)
}

function duration(operation) {
  const started = performance.now()
  const value = operation()
  return { value, milliseconds: performance.now() - started }
}

export async function runSqlitePersistenceBenchmark({ source, output }) {
  const sourcePath = resolve(source)
  const outputPath = resolve(output)
  if (sourcePath === outputPath || outputPath.startsWith(`${sourcePath}/`)) {
    throw new Error('Benchmark output must be separate from the source data directory.')
  }
  if (await pathExists(outputPath)) throw new Error('Benchmark output directory must not already exist.')

  const sourceHashesBefore = await hashLegacyData(sourcePath)
  const sourceSnapshot = await readLatestLegacySnapshot(sourcePath)
  const sourceIdentityHashes = await protectedIdentityHashes(sourcePath)
  await mkdir(dirname(outputPath), { recursive: true })
  await cp(sourcePath, outputPath, { recursive: true, force: false, errorOnExist: true })

  const migrationStarted = performance.now()
  const runtime = await activateSqliteRuntime({
    dataDir: outputPath,
    appVersion: 'sqlite-parity',
    backupServiceFactory: () => ({
      async create() {
        return { archive: Buffer.from('verified-sqlite-parity-backup') }
      },
    }),
  })
  const migrationMilliseconds = performance.now() - migrationStarted

  try {
    const targetProject = runtime.store.getProject()
    const sourceSemantic = legacySemanticSnapshot(sourceSnapshot)
    const targetSemantic = sqliteSemanticSnapshot(runtime.store.core.database)
    assertEqual(targetSemantic, sourceSemantic, 'Core semantic')
    assertEqual(topologyHash(targetProject), topologyHash(sourceSnapshot.project), 'Topology')
    assertEqual(
      runtime.store.getRegistryState().installationIdentity ?? null,
      sourceSnapshot.registry.installationIdentity ?? null,
      'Registry installation identity',
    )
    assertEqual(
      authenticationCountsFromSqlite(runtime.store.core.database),
      authenticationCountsFromLegacy(sourceSnapshot.authentication),
      'Authentication count',
    )
    assertEqual(await protectedIdentityHashes(outputPath), sourceIdentityHashes, 'Protected identity file')

    const sourceTelemetryPath = join(sourcePath, 'telemetry', 'telemetry.sqlite')
    const telemetry = (await pathExists(sourceTelemetryPath)) ? {
      source: telemetryCounts(sourceTelemetryPath),
      target: telemetryCounts(runtime.persistence.paths.telemetry),
    } : { source: {}, target: {} }
    if (Object.keys(telemetry.source).length) {
      for (const table of ['telemetry_samples', 'latest_host_state', 'latest_component_state', 'component_events']) {
        assertEqual(telemetry.target[table], telemetry.source[table], `Telemetry ${table}`)
      }
    }

    const registry = runtime.store.getRegistryState()
    const catalog = catalogIndexSummary(runtime.persistence.paths.catalog)
    const expectedCatalogRevision = sourceSnapshot.registry.snapshot?.revision ?? 0
    assertEqual(registry.snapshot?.revision ?? 0, expectedCatalogRevision, 'Catalog revision')

    runtime.store.getProject()
    const warmLoads = Array.from({ length: 25 }, () => duration(() => runtime.store.getProject()).milliseconds)
    const commandDurations = []
    let result = duration(() => runtime.store.createInventoryItems({ type: 'cpu', name: 'SQLite benchmark CPU' }))
    commandDurations.push(result.milliseconds)
    const benchmarkCpu = Object.values(result.value.items).find((item) => item.type === 'cpu' && item.name === 'SQLite benchmark CPU')
    if (!benchmarkCpu) throw new Error('Benchmark command did not create its inventory item.')
    result = duration(() => runtime.store.archiveInventoryItems([{ type: 'cpu', id: benchmarkCpu.id }]))
    commandDurations.push(result.milliseconds)
    result = duration(() => runtime.store.deleteInventoryItems([{ type: 'cpu', id: benchmarkCpu.id }]))
    commandDurations.push(result.milliseconds)

    const routeCacheBefore = runtime.store.getRoutingCache()
    const revisionBeforeHydration = runtime.store.getEngineRevision()
    runtime.store.getProject()
    const routeCacheAfter = runtime.store.getRoutingCache()
    const cache = runtime.store.cache.diagnostics()
    assertEqual(routeCacheAfter, routeCacheBefore, 'Routing cache hydration')
    assertEqual(runtime.store.getEngineRevision(), revisionBeforeHydration, 'Routing cache revision')

    const performanceReport = {
      migrationMilliseconds,
      warmWorkspaceLoadMaxMilliseconds: Math.max(...warmLoads),
      typicalCommandMaxMilliseconds: Math.max(...commandDurations),
      initialApiBootstrapRequests: INITIAL_APPLICATION_REQUEST_COUNT,
      initialApiBootstrapRequestBudget: INITIAL_APPLICATION_REQUEST_BUDGET,
      routeCacheEntries: routeCacheBefore.entries?.length ?? 0,
      routeRecomputationsOnHydration: 0,
      cache,
    }
    if (performanceReport.warmWorkspaceLoadMaxMilliseconds > 250) throw new Error('Warm workspace load exceeded 250 ms.')
    if (performanceReport.typicalCommandMaxMilliseconds > 100) throw new Error('Typical SQLite command exceeded 100 ms.')
    if (performanceReport.initialApiBootstrapRequests > performanceReport.initialApiBootstrapRequestBudget) {
      throw new Error('Initial API bootstrap request budget was exceeded.')
    }
    if (cache.maxBytes > 64 * 1024 * 1024 || cache.bytes > cache.maxBytes) throw new Error('L1 cache exceeded 64 MiB.')

    const report = {
      ok: true,
      source: sourcePath,
      output: outputPath,
      schemas: runtime.schemas,
      semantic: sourceSemantic,
      topologyHash: topologyHash(sourceSnapshot.project),
      protectedIdentityHashes: sourceIdentityHashes,
      authentication: authenticationCountsFromLegacy(sourceSnapshot.authentication),
      notifications: sourceSemantic.notifications,
      telemetry: telemetry.target,
      catalog: { revision: expectedCatalogRevision, ...catalog },
      performance: performanceReport,
    }
    await writeFile(join(outputPath, 'sqlite-parity-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    return report
  } finally {
    await runtime.close()
    assertEqual(await hashLegacyData(sourcePath), sourceHashesBefore, 'Source byte')
  }
}

if (import.meta.main) {
  const options = parseArguments(process.argv.slice(2))
  const report = await runSqlitePersistenceBenchmark(options)
  console.log(JSON.stringify(report, null, 2))
}
