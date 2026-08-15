import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type RegistryUpdateFiltersValue = {
  search: string
  category: string
  project: string
  reason: string
}

export function RegistryUpdateFilters({ value, categories, projects, reasons, reasonLabels, onChange }: {
  value: RegistryUpdateFiltersValue
  categories: string[]
  projects: Array<{ id: number; name: string }>
  reasons: string[]
  reasonLabels: Record<string, string>
  onChange: (value: RegistryUpdateFiltersValue) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#81786e]" />
        <Input value={value.search} onChange={(event) => onChange({ ...value, search: event.target.value })} placeholder="Search linked hardware" className="pl-9" />
      </div>
      <Select value={value.category} onValueChange={(category) => onChange({ ...value, category })}>
        <SelectTrigger aria-label="Filter by category"><SelectValue placeholder="All categories" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={value.project} onValueChange={(project) => onChange({ ...value, project })}>
        <SelectTrigger aria-label="Filter by project"><SelectValue placeholder="All projects" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={value.reason} onValueChange={(reason) => onChange({ ...value, reason })}>
        <SelectTrigger aria-label="Filter by reason"><SelectValue placeholder="All reasons" /></SelectTrigger>
        <SelectContent><SelectItem value="all">All reasons</SelectItem>{reasons.map((reason) => <SelectItem key={reason} value={reason}>{reasonLabels[reason] ?? reason}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}
