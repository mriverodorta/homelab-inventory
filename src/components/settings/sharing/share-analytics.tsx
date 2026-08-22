import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { loadShareAnalytics, type ShareRecord } from '@/lib/sharing-api'

export function ShareAnalytics({ shares }: { shares: readonly ShareRecord[] }) {
  const available = shares.filter((share) => share.remotePublicId)
  const [shareId, setShareId] = useState(() => available[0]?.id ?? 0)
  const analytics = useQuery({ queryKey: ['sharing', 'analytics', shareId], queryFn: () => loadShareAnalytics(shareId), enabled: shareId > 0, staleTime: Infinity })
  if (!available.length) return <div className="px-4 py-5 text-sm text-[#756d62]">Publish a share to begin receiving privacy-safe load aggregates.</div>
  return (
    <div className="grid gap-4 px-4 py-5 text-sm text-[#756d62]">
      <div className="flex flex-wrap items-center gap-2"><BarChart3 className="size-4" />{available.map((share) => <button type="button" key={share.id} aria-pressed={shareId === share.id} onClick={() => setShareId(share.id)} className="rounded-md border border-[#d8d1c6] px-3 py-1.5 font-bold aria-pressed:border-[#20242c] aria-pressed:bg-[#f1eee8]">{share.title}</button>)}</div>
      {analytics.isLoading ? <p>Loading daily aggregates…</p> : analytics.error ? <p role="alert">{analytics.error instanceof Error ? analytics.error.message : 'Analytics are unavailable.'}</p> : analytics.data ? <><div className="grid grid-cols-2 gap-3"><p className="border border-[#d8d1c6] p-3"><span className="block text-xs">Full-page loads</span><strong className="text-2xl text-[#20242c]">{analytics.data.totals.fullLoads.toLocaleString()}</strong></p><p className="border border-[#d8d1c6] p-3"><span className="block text-xs">Embed loads</span><strong className="text-2xl text-[#20242c]">{analytics.data.totals.embedLoads.toLocaleString()}</strong></p></div><table className="w-full text-left"><caption className="sr-only">Daily qualified loads</caption><thead><tr><th>Date</th><th>Full</th><th>Embed</th></tr></thead><tbody>{analytics.data.daily.map((day) => <tr key={day.date} className="border-t border-[#e8e1d6]"><td>{day.date}</td><td>{day.fullLoads}</td><td>{day.embedLoads}</td></tr>)}</tbody></table></> : null}
    </div>
  )
}
