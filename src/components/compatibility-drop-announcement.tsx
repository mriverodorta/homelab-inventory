import type { CompatibilityStatus } from '@/types/compatibility'

export function CompatibilityDropAnnouncement({
  hostName,
  status,
}: {
  hostName?: string
  status?: CompatibilityStatus
}) {
  const message = hostName && status
    ? `${hostName}: ${status} component compatibility.`
    : ''

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
