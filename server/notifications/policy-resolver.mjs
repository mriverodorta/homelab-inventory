import { notificationHostKey } from './model.mjs'

function localDateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { weekday: weekdays[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}
function clockMinutes(value) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

export function quietHoursActive(quietHours, now = Date.now()) {
  const date = new Date(now)
  return quietHours.some((schedule) => {
    if (schedule.enabled === false) return false
    let local
    try {
      local = localDateParts(date, schedule.timezone)
    } catch {
      return false
    }
    const start = clockMinutes(schedule.start)
    const end = clockMinutes(schedule.end)
    if (start === end) return schedule.weekdays.includes(local.weekday)
    if (start < end) {
      return schedule.weekdays.includes(local.weekday) && local.minutes >= start && local.minutes < end
    }
    if (local.minutes >= start) return schedule.weekdays.includes(local.weekday)
    const previousDay = (local.weekday + 6) % 7
    return local.minutes < end && schedule.weekdays.includes(previousDay)
  })
}

function mergeRule(rule, override) {
  if (!override) return structuredClone(rule)
  return {
    ...structuredClone(rule),
    ...structuredClone(override),
    id: rule.id,
    eventType: rule.eventType,
  }
}

export function resolveHostNotificationPolicy(config, hostType, hostId, now = Date.now()) {
  const hostKey = notificationHostKey(hostType, hostId)
  const override = config.hostOverrides.find((candidate) => `${candidate.hostType}:${candidate.hostId}` === hostKey) ?? null
  const mode = override?.mode ?? 'inherit'
  const mutedUntil = override?.mutedUntil ?? null
  const muted = mutedUntil !== null && Date.parse(mutedUntil) > now
  const customRules = new Map((override?.rules ?? []).map((rule) => [rule.eventType, rule]))
  const rules = config.rules.map((rule) => mergeRule(rule, mode === 'custom' ? customRules.get(rule.eventType) : null))
  const resourceIds = mode === 'custom'
    ? new Set(override?.monitoredResourceIds ?? [])
    : new Set(config.monitoredResources
      .filter((resource) => resource.hostType === hostType && resource.hostId === hostId && resource.enabled)
      .map((resource) => resource.id))
  const resources = config.monitoredResources.filter((resource) => resourceIds.has(resource.id) && resource.enabled)

  return {
    hostType,
    hostId,
    mode,
    enabled: config.enabled && mode !== 'disabled',
    muted,
    mutedUntil,
    quiet: quietHoursActive(config.quietHours, now),
    rules,
    resources,
  }
}

export function resolveRule(policy, eventType) {
  return policy.rules.find((rule) => rule.eventType === eventType) ?? null
}
