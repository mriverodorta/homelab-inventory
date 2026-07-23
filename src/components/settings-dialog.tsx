import { useState } from 'react'
import {
  Cable,
  Boxes,
  Cpu,
  FolderCog,
  Info,
  MonitorCog,
  Network,
  RefreshCw,
  RotateCcw,
  Settings,
} from 'lucide-react'
import {
  ConfirmSettingsAction,
  EnvironmentValue,
  SettingRow,
  SettingsSection,
} from '@/components/settings/settings-primitives'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  MAX_INVENTORY_WIDTH,
  MIN_INVENTORY_WIDTH,
} from '@/lib/ui-preferences'
import type { UpdateStatus } from '@/lib/update-api'
import { cn } from '@/lib/utils'

type SettingsCategory = 'general' | 'project' | 'updates' | 'about'
type SaveStatus = 'saved' | 'saving' | 'error'

export type SettingsDialogProps = {
  open: boolean
  projectName: string
  saveStatus: SaveStatus
  inventoryVisible: boolean
  inventoryWidth: number
  autoCenterOnSelect: boolean
  networkCablesVisible: boolean
  powerCablesVisible: boolean
  displayCablesVisible: boolean
  openCreatedConnectionInspector: boolean
  snapCablesToGrid: boolean
  avoidCableCollisionsGlobally: boolean
  snapItemsToGrid: boolean
  updateStatus: UpdateStatus | null
  updateLoading: boolean
  updateChecking: boolean
  updateClearingSkip: boolean
  onOpenChange: (open: boolean) => void
  onProjectNameChange: (name: string) => void
  onInventoryVisibleChange: (visible: boolean) => void
  onInventoryWidthChange: (width: number) => void
  onAutoCenterOnSelectChange: (enabled: boolean) => void
  onNetworkCablesVisibleChange: (visible: boolean) => void
  onPowerCablesVisibleChange: (visible: boolean) => void
  onDisplayCablesVisibleChange: (visible: boolean) => void
  onOpenCreatedConnectionInspectorChange: (enabled: boolean) => void
  onSnapCablesToGridChange: (enabled: boolean) => void
  onAvoidCableCollisionsGloballyChange: (enabled: boolean) => void
  onSnapItemsToGridChange: (enabled: boolean) => void
  onResetBrowserPreferences: () => void
  onClearIgnoredWarnings: () => void
  onEnableCompatibilityForAllHosts: () => void
  onCheckForUpdates: () => void
  onClearSkippedUpdate: () => void
}

const categories: Array<{
  id: SettingsCategory
  label: string
  description: string
  icon: typeof Settings
}> = [
  { id: 'general', label: 'General', description: 'Browser workspace preferences', icon: MonitorCog },
  { id: 'project', label: 'Project', description: 'Shared project configuration', icon: FolderCog },
  { id: 'updates', label: 'Updates', description: 'Image channel and status', icon: RefreshCw },
  { id: 'about', label: 'About', description: 'Purpose, version, and links', icon: Info },
]

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not checked yet'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatEnabled(value: boolean): string {
  return value ? 'Enabled' : 'Disabled'
}

function saveStatusLabel(status: SaveStatus): string {
  if (status === 'saving') return 'Saving changes'
  if (status === 'error') return 'Save failed'
  return 'Saved'
}

function CategoryNavigation({
  active,
  onChange,
}: {
  active: SettingsCategory
  onChange: (category: SettingsCategory) => void
}) {
  return (
    <nav className="hidden border-r border-[#e2dbcf] bg-[#f5f1ea] p-3 lg:block" aria-label="Settings categories">
      <div className="grid gap-1">
        {categories.map((category) => {
          const Icon = category.icon
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onChange(category.id)}
              aria-current={active === category.id ? 'page' : undefined}
              className={cn(
                'grid min-h-14 grid-cols-[20px_minmax(0,1fr)] items-start gap-2 rounded-md px-3 py-2 text-left transition-colors',
                active === category.id
                  ? 'bg-[#20242c] text-white'
                  : 'text-[#5f554b] hover:bg-white hover:text-[#20242c]',
              )}
            >
              <Icon className="mt-0.5 size-4" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-black">{category.label}</span>
                <span className={cn('mt-0.5 block text-[11px] leading-4', active === category.id ? 'text-[#d8d1c7]' : 'text-[#8a8175]')}>
                  {category.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function MobileCategorySelector({
  active,
  onChange,
}: {
  active: SettingsCategory
  onChange: (category: SettingsCategory) => void
}) {
  return (
    <div className="border-b border-[#e2dbcf] bg-[#f5f1ea] px-4 py-3 lg:hidden">
      <Select value={active} onValueChange={(value) => onChange(value as SettingsCategory)}>
        <SelectTrigger className="h-10 w-full bg-white" aria-label="Settings category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function GeneralSettings(props: SettingsDialogProps) {
  return (
    <SettingsSection title="General" description="Workspace preferences stored only in this browser.">
      <SettingRow label="Show inventory at startup" description="Keep the inventory rail open when this browser loads the workbench.">
        <Switch aria-label="Show inventory at startup" checked={props.inventoryVisible} onCheckedChange={props.onInventoryVisibleChange} />
      </SettingRow>
      <SettingRow label="Inventory width" description="Adjust the desktop inventory rail without changing the shared project.">
        <div className="grid min-w-[240px] grid-cols-[minmax(0,1fr)_58px] items-center gap-3">
          <Slider
            aria-label="Inventory width"
            min={MIN_INVENTORY_WIDTH}
            max={MAX_INVENTORY_WIDTH}
            step={1}
            value={[props.inventoryWidth]}
            onValueChange={(value) => props.onInventoryWidthChange(value[0])}
          />
          <span className="text-right text-sm font-black tabular-nums text-[#20242c]">{props.inventoryWidth} px</span>
        </div>
      </SettingRow>
      <SettingRow label="Center selected equipment" description="Reframe the canvas when an item opens in the inspector.">
        <Switch aria-label="Center selected equipment" checked={props.autoCenterOnSelect} onCheckedChange={props.onAutoCenterOnSelectChange} />
      </SettingRow>
      <SettingRow label="Show network cables" description="Display saved Ethernet and SFP connections on the canvas.">
        <Switch aria-label="Show network cables" checked={props.networkCablesVisible} onCheckedChange={props.onNetworkCablesVisibleChange} />
      </SettingRow>
      <SettingRow label="Show power cables" description="Display saved AC power connections on the canvas.">
        <Switch aria-label="Show power cables" checked={props.powerCablesVisible} onCheckedChange={props.onPowerCablesVisibleChange} />
      </SettingRow>
      <SettingRow label="Show display cables" description="Display saved HDMI and DisplayPort connections on the canvas.">
        <Switch aria-label="Show display cables" checked={props.displayCablesVisible} onCheckedChange={props.onDisplayCablesVisibleChange} />
      </SettingRow>
      <SettingRow
        label="Open new connections in Inspector"
        description="Select a connection and open its Inspector immediately after it is created."
      >
        <Switch
          aria-label="Open new connections in Inspector"
          checked={props.openCreatedConnectionInspector}
          onCheckedChange={props.onOpenCreatedConnectionInspectorChange}
        />
      </SettingRow>
      <SettingRow label="Snap cables to grid" description="Route automatic cable sections and edited bends on 12 px lanes.">
        <Switch aria-label="Snap cables to grid" checked={props.snapCablesToGrid} onCheckedChange={props.onSnapCablesToGridChange} />
      </SettingRow>
      <SettingRow label="Avoid cable collisions globally" description="Route every cable on separate lanes without changing individual cable preferences.">
        <Switch
          aria-label="Avoid cable collisions globally"
          checked={props.avoidCableCollisionsGlobally}
          onCheckedChange={props.onAvoidCableCollisionsGloballyChange}
        />
      </SettingRow>
      <SettingRow label="Snap canvas items to grid" description="Align newly placed and subsequently moved equipment to the 24 px dot grid.">
        <Switch aria-label="Snap canvas items to grid" checked={props.snapItemsToGrid} onCheckedChange={props.onSnapItemsToGridChange} />
      </SettingRow>
      <SettingRow label="Reset browser preferences" description="Restore only this browser's workspace controls to their defaults.">
        <ConfirmSettingsAction
          title="Reset browser preferences?"
          description="Inventory layout, selection, cable display, connection Inspector, collision avoidance, and grid snapping preferences will return to their defaults in this browser. Project data is not changed."
          actionLabel="Reset preferences"
          onConfirm={props.onResetBrowserPreferences}
        />
      </SettingRow>
    </SettingsSection>
  )
}

function ProjectSettings(props: SettingsDialogProps) {
  return (
    <SettingsSection title="Project" description="Shared settings saved with this inventory project.">
      <SettingRow label="Project name" description={`Autosave status: ${saveStatusLabel(props.saveStatus)}`}>
        <Input
          aria-label="Project name"
          value={props.projectName}
          onChange={(event) => props.onProjectNameChange(event.target.value)}
          className="w-full sm:w-[320px]"
        />
      </SettingRow>
      <SettingRow label="Ignored audit findings" description="Restore individually ignored findings to the active audit when they still apply.">
        <ConfirmSettingsAction
          title="Clear ignored audit findings?"
          description="Previously ignored findings will return to the active audit if they still apply. Host compatibility opt-outs remain unchanged."
          actionLabel="Clear ignored findings"
          onConfirm={props.onClearIgnoredWarnings}
        />
      </SettingRow>
      <SettingRow label="Host compatibility checks" description="Remove all server and NAS compatibility opt-outs in this project.">
        <ConfirmSettingsAction
          title="Enable compatibility checks for all hosts?"
          description="Compatibility checks will be re-enabled for every server and NAS. Ignored individual findings remain unchanged."
          actionLabel="Enable for all hosts"
          onConfirm={props.onEnableCompatibilityForAllHosts}
        />
      </SettingRow>
    </SettingsSection>
  )
}

function UpdateSettings(props: SettingsDialogProps) {
  const status = props.updateStatus
  const channel = status?.channel ?? 'stable'
  const enabled = status?.enabled ?? false

  return (
    <SettingsSection title="Updates" description="Inspect the configured Docker image channel and request a fresh availability check.">
      <SettingRow label="Update channel">
        <EnvironmentValue label="Update channel" value={channel} />
      </SettingRow>
      <SettingRow label="Automatic checks">
        <EnvironmentValue label="Automatic checks" value={formatEnabled(enabled)} />
      </SettingRow>
      {props.updateLoading && !status ? (
        <div className="p-4 text-sm font-semibold text-[#756d62]">Loading update status…</div>
      ) : (
        <>
          <SettingRow label="Running image" description={status?.runningRevision ?? 'Revision unavailable'}>
            <span className="font-mono text-sm font-black text-[#20242c]">{status?.runningVersion ?? 'Unknown'}</span>
          </SettingRow>
          <SettingRow label="Available image" description={status?.availableRevision ?? 'Revision unavailable'}>
            <span className="font-mono text-sm font-black text-[#20242c]">{status?.availableVersion ?? 'Unknown'}</span>
          </SettingRow>
          <SettingRow label="Last checked" description={`State: ${status?.state ?? 'unknown'}`}>
            <span className="text-sm font-bold text-[#403a33]">{formatDate(status?.checkedAt)}</span>
          </SettingRow>
        </>
      )}
      <SettingRow label="Check for updates" description="Refresh Docker Hub image metadata now.">
        <Button type="button" variant="outline" onClick={props.onCheckForUpdates} disabled={props.updateChecking}>
          <RefreshCw className={cn('size-4', props.updateChecking && 'animate-spin')} />
          {props.updateChecking ? 'Checking…' : 'Check now'}
        </Button>
      </SettingRow>
      {status?.skipped ? (
        <SettingRow label="Skipped version" description="Allow the currently skipped image to appear as available again.">
          <Button type="button" variant="outline" onClick={props.onClearSkippedUpdate} disabled={props.updateClearingSkip}>
            <RotateCcw className="size-4" />
            {props.updateClearingSkip ? 'Clearing…' : 'Clear skipped version'}
          </Button>
        </SettingRow>
      ) : null}
    </SettingsSection>
  )
}

function AboutSettings(props: SettingsDialogProps) {
  const version = props.updateStatus?.runningVersion ?? 'Unknown'
  const revision = props.updateStatus?.runningRevision ?? 'Unknown'
  const purposeItems = [
    { icon: Boxes, text: 'Keep servers, NAS devices, switches, patch panels, and reusable components in one inventory.' },
    { icon: Cpu, text: 'Assign components to hosts and review hardware compatibility before changing a build.' },
    { icon: Network, text: 'Arrange equipment on an infinite canvas that reflects the physical shape of a homelab.' },
    { icon: Cable, text: 'Document ports, cable paths, negotiated network speeds, and end-to-end connections.' },
  ]

  return (
    <SettingsSection title="About" description="Homelab Inventory is a self-hosted hardware and cabling workbench for documenting the equipment that runs your lab.">
      <div className="grid gap-3 border-b border-[#e8e1d6] p-4 sm:grid-cols-2">
        {purposeItems.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-start gap-3 rounded-md border border-[#e2dbcf] bg-[#fbf9f5] p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-white">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <p className="text-sm leading-5 text-[#554b40]">{text}</p>
          </div>
        ))}
      </div>
      <div className="border-b border-[#e8e1d6] bg-[#f7f2e9] px-4 py-3 text-sm leading-5 text-[#554b40]">
        Project data stays in the configured data directory so container updates do not replace your inventory.
      </div>
      <SettingRow label="Version" description={`Build ${revision}`}>
        <span className="font-mono text-sm font-black text-[#20242c]">{version}</span>
      </SettingRow>
      <div className="grid gap-4 border-b border-[#e8e1d6] p-4 sm:grid-cols-2">
        <div className="rounded-md border border-[#c5ddcf] bg-[#eef8f2] p-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#2b684b]">Stable</p>
          <p className="mt-2 text-sm leading-5 text-[#405047]">Recommended for normal deployments and updated after changes have been promoted.</p>
        </div>
        <div className="rounded-md border border-[#d9cfbf] bg-[#f8f3eb] p-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#755d3e]">Latest</p>
          <p className="mt-2 text-sm leading-5 text-[#554b40]">The newest main-branch build. It may include changes that have not reached stable yet.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        <Button asChild variant="outline"><a href="https://github.com/mriverodorta/homelab-inventory" target="_blank" rel="noreferrer">GitHub repository</a></Button>
        <Button asChild variant="outline"><a href="https://github.com/mriverodorta/homelab-inventory#readme" target="_blank" rel="noreferrer">Documentation</a></Button>
      </div>
    </SettingsSection>
  )
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [category, setCategory] = useState<SettingsCategory>('general')

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="h-[100dvh] max-h-[100dvh] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none bg-[#fbf9f5] p-0 sm:h-[min(760px,calc(100dvh-2rem))] sm:max-w-5xl sm:rounded-xl">
        <DialogHeader className="border-b border-[#e2dbcf] px-5 py-4 pr-14 text-left">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-white"><Settings className="size-5" /></span>
            <div className="min-w-0">
              <DialogTitle className="text-xl font-black text-[#20242c]">Settings</DialogTitle>
              <DialogDescription className="truncate text-sm text-[#756d62]">{props.projectName}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid min-h-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <CategoryNavigation active={category} onChange={setCategory} />
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
            <MobileCategorySelector active={category} onChange={setCategory} />
            <main className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6" aria-live="polite">
              {category === 'general' ? <GeneralSettings {...props} /> : null}
              {category === 'project' ? <ProjectSettings {...props} /> : null}
              {category === 'updates' ? <UpdateSettings {...props} /> : null}
              {category === 'about' ? <AboutSettings {...props} /> : null}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { categories as SETTINGS_CATEGORIES }
