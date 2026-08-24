export function agentCommandPlatform(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized.includes('alpine')) return 'alpine'
  if (normalized.includes('freebsd') || normalized.includes('opnsense')) return 'freebsd'
  return 'linux'
}
