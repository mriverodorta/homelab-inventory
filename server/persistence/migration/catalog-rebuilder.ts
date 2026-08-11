import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  validateCatalogFacetIndex,
  validateCatalogSnapshot,
  verifySignedCatalogArtifact,
} from '../../../packages/catalog-protocol/src/index.ts'
import { CatalogIndex } from '../../registry/catalog-index.mjs'

type SnapshotService = Readonly<{
  trustedKeys: readonly unknown[]
  resolveActivePaths(): Promise<null | { snapshot: string, facets?: string | null }>
}>

type RebuildOptions = Readonly<{
  snapshotService: SnapshotService
  targetPath: string
}>

async function verifiedArtifacts(snapshotService: SnapshotService) {
  const paths = await snapshotService.resolveActivePaths()
  if (!paths) throw new Error('Cannot rebuild a catalog index without an active signed snapshot.')
  const artifact = JSON.parse(await readFile(paths.snapshot, 'utf8'))
  const payload = await verifySignedCatalogArtifact(artifact, snapshotService.trustedKeys as any)
  const validationTime = payload.expiresAt
    ? new Date(Date.parse(payload.expiresAt) - 1)
    : new Date(Math.max(Date.now(), Date.parse(payload.generatedAt)))
  const snapshot = await validateCatalogSnapshot(payload, { now: validationTime })
  let facets = null
  if (paths.facets) {
    const facetArtifact = JSON.parse(await readFile(paths.facets, 'utf8'))
    facets = validateCatalogFacetIndex(await verifySignedCatalogArtifact(facetArtifact, snapshotService.trustedKeys as any, { now: validationTime }))
    if (facets.catalogRevision !== snapshot.catalogRevision) {
      throw new Error('Catalog facet index revision does not match its snapshot.')
    }
  }
  return { snapshot, facets }
}

export async function rebuildVerifiedCatalog({ snapshotService, targetPath }: RebuildOptions) {
  const target = resolve(targetPath)
  const temporary = `${target}.${process.pid}-${randomUUID()}.staging`
  await rm(temporary, { force: true })
  try {
    const { snapshot, facets } = await verifiedArtifacts(snapshotService)
    const index = new CatalogIndex(temporary)
    await index.rebuild(snapshot, temporary, facets)
    const verification = index.verify(snapshot, facets)
    await chmod(temporary, 0o600)
    await rename(temporary, target)
    return {
      targetPath: target,
      catalogRevision: snapshot.catalogRevision,
      ...verification,
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
