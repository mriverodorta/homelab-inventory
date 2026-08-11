import { asc, eq } from 'drizzle-orm'
import {
  registryCatalogAdoptionStatus,
  registryLinks,
  registrySettings,
  registrySources,
} from '../schema/index.ts'
import { assertPositiveId, type RepositoryContext } from './repository-context.ts'

export function createRegistryRepository({ db, now }: RepositoryContext) {
  function getSettings() {
    return db.select().from(registrySettings).where(eq(registrySettings.id, 1)).get() ?? null
  }

  function listSources() {
    return db.select().from(registrySources).orderBy(asc(registrySources.id)).all()
  }

  function listLinks() {
    return db.select().from(registryLinks).orderBy(asc(registryLinks.id)).all()
  }

  function findItemLink(itemId: number) {
    return db.select().from(registryLinks)
      .where(eq(registryLinks.itemId, assertPositiveId(itemId, 'Inventory item ID'))).get() ?? null
  }

  function updateLinkState(linkId: number, state: 'linked' | 'update-available' | 'adoption-available' | 'detached' | 'contribution-pending', availableRevision?: number | null) {
    const result = db.update(registryLinks).set({
      state,
      availableRevision: availableRevision ?? null,
      updatedAtMs: now(),
    }).where(eq(registryLinks.id, assertPositiveId(linkId, 'Registry link ID'))).run()
    if (result.changes !== 1) throw new Error(`Registry link ${linkId} was not found.`)
  }

  function recordAdoption(input: {
    sourceId: number
    catalogRevision: number
    applicationVersion: string
    lastError?: string | null
  }) {
    const sourceId = assertPositiveId(input.sourceId, 'Registry source ID')
    db.insert(registryCatalogAdoptionStatus).values({
      sourceId,
      catalogRevision: assertPositiveId(input.catalogRevision, 'Catalog revision'),
      applicationVersion: input.applicationVersion,
      reportedAtMs: now(),
      lastError: input.lastError ?? null,
    }).onConflictDoUpdate({
      target: registryCatalogAdoptionStatus.sourceId,
      set: {
        catalogRevision: input.catalogRevision,
        applicationVersion: input.applicationVersion,
        reportedAtMs: now(),
        lastError: input.lastError ?? null,
      },
    }).run()
  }

  return { getSettings, listSources, listLinks, findItemLink, updateLinkState, recordAdoption }
}

export type RegistryRepository = ReturnType<typeof createRegistryRepository>
