import { z } from 'zod'

import { findForbiddenShareField } from './privacy'
import { SHARE_CONTRACT_VERSION, SUPPORTED_VIEW_SCHEMAS } from './version'

const PublicIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const NonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe()
const PositiveSafeIntegerSchema = z.number().int().positive().safe()
const PercentageSchema = z.number().finite().min(0).max(100)

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]))

const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

export const RegistryReferenceSchema = z.strictObject({
  templateKey: z.string().trim().min(1).max(240),
  templateRevision: PositiveSafeIntegerSchema,
  contentHash: Sha256Schema,
})

export const ShareViewDescriptorSchema = z.strictObject({
  publicViewId: PublicIdSchema,
  type: z.enum(['systems', 'canvas']),
  schemaVersion: PositiveSafeIntegerSchema,
  contentHash: Sha256Schema,
  sortOrder: NonNegativeSafeIntegerSchema,
  name: z.string().trim().min(1).max(120),
})

const VisibilitySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('public') }),
  z.strictObject({ type: z.literal('unlisted') }),
  z.strictObject({ type: z.literal('protected') }),
])

const PublicationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('immutable') }),
  z.strictObject({
    type: z.literal('replaceable'),
    updateMode: z.enum(['manual', 'synchronized']),
  }),
])

const ExpirationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('indefinite') }),
  z.strictObject({
    type: z.literal('duration'),
    durationSeconds: PositiveSafeIntegerSchema.max(31_536_000),
  }),
  z.strictObject({
    type: z.literal('at'),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
])

const ToggleSchema = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({ enabled: z.literal(true) }),
])

const EmbedOriginsSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('any') }),
  z.strictObject({
    type: z.literal('allowlist'),
    origins: z.array(z.url({ protocol: /^https$/ })).min(1).max(100),
  }),
])

const EmbedPolicySchema = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({ enabled: z.literal(true), origins: EmbedOriginsSchema }),
])

const ResourceSnapshotPolicySchema = z.discriminatedUnion('included', [
  z.strictObject({ included: z.literal(false) }),
  z.strictObject({ included: z.literal(true), capturedAt: z.iso.datetime({ offset: true }) }),
])

const RendererFeatureSchema = z.enum([
  'workbook-tabs',
  'deep-links',
  'inspector',
  'resource-snapshot',
  'comments-coming-soon',
  'reactions-coming-soon',
])

export const ShareManifestSchema = z.strictObject({
  shareContractVersion: z.literal(SHARE_CONTRACT_VERSION),
  projectPublicId: PublicIdSchema,
  projectLabel: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(10_000).optional(),
  visibility: VisibilitySchema,
  publication: PublicationSchema,
  expiration: ExpirationSchema,
  comments: ToggleSchema,
  reactions: ToggleSchema,
  embed: EmbedPolicySchema,
  resourceSnapshots: ResourceSnapshotPolicySchema,
  rendererFeatures: z.array(RendererFeatureSchema).max(16),
  initialViewPublicId: PublicIdSchema,
  views: z.array(ShareViewDescriptorSchema).min(1).max(100),
}).superRefine((manifest, context) => {
  const ids = new Set<string>()
  const sortOrders = new Set<number>()
  for (const [index, view] of manifest.views.entries()) {
    if (ids.has(view.publicViewId)) {
      context.addIssue({ code: 'custom', path: ['views', index, 'publicViewId'], message: 'View public IDs must be unique.' })
    }
    if (sortOrders.has(view.sortOrder)) {
      context.addIssue({ code: 'custom', path: ['views', index, 'sortOrder'], message: 'View sort orders must be unique.' })
    }
    ids.add(view.publicViewId)
    sortOrders.add(view.sortOrder)

    if (view.schemaVersion !== SUPPORTED_VIEW_SCHEMAS[view.type]) {
      context.addIssue({ code: 'custom', path: ['views', index, 'schemaVersion'], message: `Unsupported ${view.type} schema version.` })
    }
  }

  if (!ids.has(manifest.initialViewPublicId)) {
    context.addIssue({ code: 'custom', path: ['initialViewPublicId'], message: 'The initial view must be declared in views.' })
  }

  if (manifest.visibility.type === 'protected' && manifest.embed.enabled && manifest.embed.origins.type === 'any') {
    context.addIssue({ code: 'custom', path: ['embed', 'origins'], message: 'Protected shares cannot allow wildcard embedding.' })
  }
})

const PublicPortSchema = z.strictObject({
  publicPortId: PublicIdSchema,
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(80),
  connector: z.string().trim().min(1).max(80).optional(),
  side: z.enum(['top', 'right', 'bottom', 'left', 'front', 'back']).optional(),
  speedBps: NonNegativeSafeIntegerSchema.optional(),
})

const PublicTagSchema = z.strictObject({
  publicTagId: PublicIdSchema,
  name: z.string().trim().min(1).max(80),
  colorToken: z.string().trim().min(1).max(40),
})

const PublicCustomFieldSchema = z.strictObject({
  publicFieldId: PublicIdSchema,
  name: z.string().trim().min(1).max(120),
  value: JsonValueSchema,
})

const PublicItemSourceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('registry'),
    registryReference: RegistryReferenceSchema,
    localOverrides: JsonObjectSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('custom'),
    definition: JsonObjectSchema,
  }),
])

export const PublicItemSchema = z.strictObject({
  publicItemId: PublicIdSchema,
  type: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  manufacturer: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  source: PublicItemSourceSchema,
  ports: z.array(PublicPortSchema).max(512),
  tags: z.array(PublicTagSchema).max(100).optional(),
  customFields: z.array(PublicCustomFieldSchema).max(100).optional(),
})

const ResourceSnapshotSchema = z.strictObject({
  capturedAt: z.iso.datetime({ offset: true }),
  cpu: z.strictObject({ usagePercent: PercentageSchema }).optional(),
  memory: z.strictObject({
    totalBytes: NonNegativeSafeIntegerSchema,
    usedBytes: NonNegativeSafeIntegerSchema,
    availableBytes: NonNegativeSafeIntegerSchema,
    buffersBytes: NonNegativeSafeIntegerSchema.optional(),
    cacheBytes: NonNegativeSafeIntegerSchema.optional(),
    sharedBytes: NonNegativeSafeIntegerSchema.optional(),
  }).optional(),
  storage: z.array(z.strictObject({
    publicStorageId: PublicIdSchema,
    name: z.string().trim().min(1).max(160),
    totalBytes: NonNegativeSafeIntegerSchema,
    usedBytes: NonNegativeSafeIntegerSchema,
  })).max(128).optional(),
})

const SystemsViewBlobSchema = z.strictObject({
  shareContractVersion: z.literal(SHARE_CONTRACT_VERSION),
  viewType: z.literal('systems'),
  schemaVersion: z.literal(SUPPORTED_VIEW_SCHEMAS.systems),
  publicViewId: PublicIdSchema,
  items: z.array(PublicItemSchema.extend({ resourceSnapshot: ResourceSnapshotSchema.optional() })).max(10_000),
})

const CanvasNodeSchema = z.strictObject({
  publicNodeId: PublicIdSchema,
  publicItemId: PublicIdSchema,
  parentPublicNodeId: PublicIdSchema.optional(),
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  size: z.strictObject({ width: z.number().finite().positive(), height: z.number().finite().positive() }),
  zIndex: z.number().int().safe().optional(),
})

const ConnectionEndpointSchema = z.strictObject({
  publicItemId: PublicIdSchema,
  publicPortId: PublicIdSchema.optional(),
})

const CanvasConnectionSchema = z.strictObject({
  publicConnectionId: PublicIdSchema,
  kind: z.string().trim().min(1).max(80),
  source: ConnectionEndpointSchema,
  target: ConnectionEndpointSchema,
  label: z.string().trim().min(1).max(160).optional(),
  color: z.string().trim().min(1).max(40).optional(),
  route: z.array(z.strictObject({ x: z.number().finite(), y: z.number().finite() })).max(1_024),
})

const CanvasViewBlobSchema = z.strictObject({
  shareContractVersion: z.literal(SHARE_CONTRACT_VERSION),
  viewType: z.literal('canvas'),
  schemaVersion: z.literal(SUPPORTED_VIEW_SCHEMAS.canvas),
  publicViewId: PublicIdSchema,
  items: z.array(PublicItemSchema).max(10_000),
  nodes: z.array(CanvasNodeSchema).max(10_000),
  connections: z.array(CanvasConnectionSchema).max(100_000),
  viewport: z.strictObject({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().positive(),
  }).optional(),
})

export const ShareViewBlobSchema = z.discriminatedUnion('viewType', [
  SystemsViewBlobSchema,
  CanvasViewBlobSchema,
]).superRefine((blob, context) => {
  const forbidden = findForbiddenShareField(blob)
  if (forbidden) context.addIssue({ code: 'custom', path: [], message: `Forbidden private field found at ${forbidden}.` })
})

export type RegistryReference = z.infer<typeof RegistryReferenceSchema>
export type ShareManifest = z.infer<typeof ShareManifestSchema>
export type ShareViewDescriptor = z.infer<typeof ShareViewDescriptorSchema>
export type PublicItem = z.infer<typeof PublicItemSchema>
export type ShareViewBlob = z.infer<typeof ShareViewBlobSchema>
export type SystemsViewBlob = z.infer<typeof SystemsViewBlobSchema>
export type CanvasViewBlob = z.infer<typeof CanvasViewBlobSchema>

export const parseShareManifest = (value: unknown): ShareManifest => ShareManifestSchema.parse(value)
export const parseShareViewBlob = (value: unknown): ShareViewBlob => ShareViewBlobSchema.parse(value)
