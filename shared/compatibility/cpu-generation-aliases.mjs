function normalized(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : ''
}

export const CPU_GENERATION_ALIAS_VERSION = 1

const DIRECT_ALIASES = new Map([
  ['10th gen', ['product:intel:10th-gen']],
  ['10th generation', ['product:intel:10th-gen']],
  ['products formerly comet lake', ['product:intel:10th-gen', 'codename:intel:comet-lake']],
  ['comet lake', ['product:intel:10th-gen', 'codename:intel:comet-lake']],
  ['11th gen', ['product:intel:11th-gen']],
  ['11th generation', ['product:intel:11th-gen']],
  ['products formerly rocket lake', ['product:intel:11th-gen', 'codename:intel:rocket-lake']],
  ['rocket lake', ['product:intel:11th-gen', 'codename:intel:rocket-lake']],
  ['13th gen', ['product:intel:13th-gen']],
  ['13th generation', ['product:intel:13th-gen']],
  ['ryzen pro 4000', ['product:amd:ryzen-pro-4000']],
  ['ryzen 4000', ['product:amd:ryzen-4000']],
  ['zen 2', ['architecture:amd:zen-2']],
  ['zen 3', ['architecture:amd:zen-3']],
])

export function canonicalCpuGenerationTokens(value) {
  const key = normalized(value)
  if (!key) return Object.freeze([])
  return Object.freeze([...(DIRECT_ALIASES.get(key) ?? [`literal:${key}`])])
}

export function inferCpuProductGenerationTokens(item) {
  const identity = normalized([
    item?.manufacturer,
    item?.family,
    item?.model,
    item?.number,
    item?.name,
  ].filter(Boolean).join(' '))
  const tokens = []
  if (/\b(?:ryzen\s+\d\s+)?pro\b/.test(identity) && /\b4[0-9]{3}[a-z]{0,2}\b/.test(identity)) {
    tokens.push('product:amd:ryzen-pro-4000')
  } else if (/\bryzen\b/.test(identity) && /\b4[0-9]{3}[a-z]{0,2}\b/.test(identity)) {
    tokens.push('product:amd:ryzen-4000')
  }
  return Object.freeze(tokens)
}
