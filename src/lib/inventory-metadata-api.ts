import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import {
  customFieldDefinitionSchema,
  inventoryItemMetadataSchema,
  inventoryMetadataCatalogSchema,
  inventoryMetadataImpactSchema,
  inventoryMetadataProjectProjectionSchema,
  inventoryTagSchema,
  type CustomFieldDefinition,
  type CustomFieldDefinitionInput,
  type InventoryItemMetadata,
  type InventoryItemMetadataInput,
  type InventoryMetadataCatalog,
  type InventoryMetadataImpact,
  type InventoryMetadataItemRef,
  type InventoryMetadataFilter,
  type InventoryMetadataProjectProjection,
  type InventoryTag,
  type InventoryTagInput,
} from '@/types/inventory-metadata'
import { z } from 'zod'

const catalogCache = new Map<string, { etag: string; payload: InventoryMetadataCatalog }>()
const itemCache = new Map<string, { etag: string; payload: InventoryItemMetadata }>()
const projectionCache = new Map<string, { etag: string; payload: InventoryMetadataProjectProjection }>()

export class InventoryMetadataRequestError extends Error {
  readonly code: string | null
  readonly status: number
  readonly details: unknown

  constructor(message: string, options: { code?: string; status: number; details?: unknown }) {
    super(message)
    this.name = 'InventoryMetadataRequestError'
    this.code = options.code ?? null
    this.status = options.status
    this.details = options.details
  }
}

function itemPath(ref: InventoryMetadataItemRef) {
  return `/api/inventory/items/${encodeURIComponent(ref.type)}/${ref.id}/metadata`
}

async function responsePayload(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null) as {
    message?: string
    code?: string
    details?: unknown
  } | null
  if (!response.ok) {
    throw new InventoryMetadataRequestError(
      payload?.message ?? `Inventory metadata request failed with status ${response.status}.`,
      { status: response.status, code: payload?.code, details: payload?.details },
    )
  }
  return payload
}

async function etagRequest<T>(
  url: string,
  cache: Map<string, { etag: string; payload: T }>,
  schema: z.ZodType<T>,
) {
  const cached = cache.get(url)
  const response = await fetchWithTimeout(url, {
    headers: cached ? { 'If-None-Match': cached.etag } : undefined,
  })
  if (response.status === 304) {
    if (!cached) throw new Error('Inventory metadata cache was unavailable after a not-modified response.')
    return cached.payload
  }
  const payload = schema.parse(await responsePayload(response))
  const responseEtag = response.headers.get('etag')
  if (responseEtag) cache.set(url, { etag: responseEtag, payload })
  return payload
}

async function etagPost<T>(
  url: string,
  body: unknown,
  cache: Map<string, { etag: string; payload: T }>,
  schema: z.ZodType<T>,
) {
  const key = `${url}:${JSON.stringify(body)}`
  const cached = cache.get(key)
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}) },
    body: JSON.stringify(body),
  })
  if (response.status === 304) {
    if (!cached) throw new Error('Inventory metadata projection cache was unavailable after a not-modified response.')
    return cached.payload
  }
  const payload = schema.parse(await responsePayload(response))
  const responseEtag = response.headers.get('etag')
  if (responseEtag) cache.set(key, { etag: responseEtag, payload })
  return payload
}

async function mutation<T>(url: string, schema: z.ZodType<T>, init: RequestInit) {
  const payload = await responsePayload(await fetchWithTimeout(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  }))
  return schema.parse(payload)
}

export function loadInventoryMetadataCatalog(includeArchived = false) {
  const url = `/api/inventory-metadata/catalog${includeArchived ? '?includeArchived=true' : ''}`
  return etagRequest(url, catalogCache, inventoryMetadataCatalogSchema)
}

export function loadInventoryItemMetadata(ref: InventoryMetadataItemRef) {
  const url = itemPath(ref)
  return etagRequest(url, itemCache, inventoryItemMetadataSchema)
}

export type InventoryMetadataProjectQuery = Readonly<{
  scope?: 'inventory' | 'systems'
  definitionIds?: readonly number[]
  filters?: readonly InventoryMetadataFilter[]
  includeSearch?: boolean
}>

export function loadInventoryMetadataProjectProjection(projectId: number, query: InventoryMetadataProjectQuery) {
  return etagPost(
    `/api/projects/${projectId}/inventory-metadata/query`,
    query,
    projectionCache,
    inventoryMetadataProjectProjectionSchema,
  )
}

const definitionResponse = z.strictObject({ definition: customFieldDefinitionSchema })
const tagResponse = z.strictObject({ tag: inventoryTagSchema })
const impactResponse = z.strictObject({ impact: inventoryMetadataImpactSchema })
const deleteResponse = z.strictObject({ deleted: z.literal(true), impact: inventoryMetadataImpactSchema })
const itemMutationResponse = z.strictObject({
  metadata: inventoryItemMetadataSchema,
  affectedProjectIds: z.array(z.number().int().safe().positive()),
  affectedProjectRevisions: z.record(z.string(), z.number().int().safe().positive()),
})

export async function createCustomField(input: CustomFieldDefinitionInput): Promise<CustomFieldDefinition> {
  return (await mutation('/api/inventory-metadata/definitions', definitionResponse, {
    method: 'POST', body: JSON.stringify(input),
  })).definition
}

export async function updateCustomField(
  id: number,
  expectedRevision: number,
  input: CustomFieldDefinitionInput & { deleteValuesForRemovedTypes?: boolean },
): Promise<CustomFieldDefinition> {
  return (await mutation(`/api/inventory-metadata/definitions/${id}`, definitionResponse, {
    method: 'PUT', body: JSON.stringify({ ...input, expectedRevision }),
  })).definition
}

export async function setCustomFieldArchived(id: number, expectedRevision: number, archived: boolean) {
  return (await mutation(`/api/inventory-metadata/definitions/${id}/${archived ? 'archive' : 'restore'}`, definitionResponse, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  })).definition
}

export async function loadCustomFieldImpact(id: number): Promise<InventoryMetadataImpact> {
  return (await mutation(`/api/inventory-metadata/definitions/${id}/impact`, impactResponse, { method: 'GET' })).impact
}

export async function deleteCustomField(id: number, confirmationName: string) {
  return mutation(`/api/inventory-metadata/definitions/${id}`, deleteResponse, {
    method: 'DELETE', body: JSON.stringify({ confirmationName }),
  })
}

export function reorderCustomFields(ids: readonly number[]) {
  return mutation('/api/inventory-metadata/definitions/order', inventoryMetadataCatalogSchema, {
    method: 'PUT', body: JSON.stringify({ ids }),
  })
}

export async function createInventoryTag(input: InventoryTagInput): Promise<InventoryTag> {
  return (await mutation('/api/inventory-metadata/tags', tagResponse, {
    method: 'POST', body: JSON.stringify(input),
  })).tag
}

export async function updateInventoryTag(id: number, expectedRevision: number, input: InventoryTagInput): Promise<InventoryTag> {
  return (await mutation(`/api/inventory-metadata/tags/${id}`, tagResponse, {
    method: 'PUT', body: JSON.stringify({ ...input, expectedRevision }),
  })).tag
}

export async function setInventoryTagArchived(id: number, expectedRevision: number, archived: boolean) {
  return (await mutation(`/api/inventory-metadata/tags/${id}/${archived ? 'archive' : 'restore'}`, tagResponse, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  })).tag
}

export async function loadInventoryTagImpact(id: number): Promise<InventoryMetadataImpact> {
  return (await mutation(`/api/inventory-metadata/tags/${id}/impact`, impactResponse, { method: 'GET' })).impact
}

export function deleteInventoryTag(id: number, confirmationName: string) {
  return mutation(`/api/inventory-metadata/tags/${id}`, deleteResponse, {
    method: 'DELETE', body: JSON.stringify({ confirmationName }),
  })
}

export function reorderInventoryTags(ids: readonly number[]) {
  return mutation('/api/inventory-metadata/tags/order', inventoryMetadataCatalogSchema, {
    method: 'PUT', body: JSON.stringify({ ids }),
  })
}

export async function updateInventoryItemMetadata(ref: InventoryMetadataItemRef, input: InventoryItemMetadataInput) {
  const response = await mutation(itemPath(ref), itemMutationResponse, {
    method: 'PUT', body: JSON.stringify(input),
  })
  itemCache.delete(itemPath(ref))
  return response
}

export function resetInventoryMetadataHttpCache() {
  catalogCache.clear()
  itemCache.clear()
}
