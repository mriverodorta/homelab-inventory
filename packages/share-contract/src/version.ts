export const SHARE_CONTRACT_VERSION = 1 as const

export const SUPPORTED_VIEW_SCHEMAS = Object.freeze({
  systems: 1,
  canvas: 1,
} as const)

export type ShareViewType = keyof typeof SUPPORTED_VIEW_SCHEMAS
