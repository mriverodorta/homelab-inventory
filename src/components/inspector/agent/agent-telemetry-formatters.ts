export const AGENT_PERCENTAGE_TICKS = [0, 25, 50, 75, 100] as const

export function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes < 1) return '<1m'
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, minutes || (!days && !hours) ? `${minutes}m` : null]
    .filter(Boolean)
    .join(' ')
}

function textValue(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function formatOperatingSystem(system: Record<string, unknown> | null | undefined): string | null {
  const distributionName = textValue(system, 'distributionName')
  if (distributionName) return distributionName
  const distribution = textValue(system, 'distribution')
  const distributionVersion = textValue(system, 'distributionVersion')
  if (distribution || distributionVersion) return [distribution, distributionVersion].filter(Boolean).join(' ')
  const operatingSystem = textValue(system, 'operatingSystem')
  const kernel = textValue(system, 'kernel')
  return operatingSystem ? [operatingSystem, kernel].filter(Boolean).join(' ') : null
}
