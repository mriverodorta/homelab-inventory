import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Cable,
  ArchiveRestore,
  Boxes,
  Cpu,
  Database,
  FolderCog,
  Info,
  Bug,
  Lightbulb,
  Map,
  MessageSquarePlus,
  MonitorCog,
  Network,
  BellRing,
  Play,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  RotateCcw,
  Settings,
  Share2,
  Tags,
} from 'lucide-react'
import {
  ConfirmSettingsAction,
  EnvironmentValue,
  SettingRow,
  SettingsSection,
} from '@/components/settings/settings-primitives'
import { Button } from '@/components/ui/button'
import { CatalogSourceStatus } from '@/components/settings/catalog-source-status'
import { BackupRestoreSettings } from '@/components/settings/backup-restore-settings'
import { AuthenticationSettings } from '@/components/settings/authentication-settings'
import { useAuth } from '@/hooks/use-auth'
import { hasPermission, usePermission } from '@/hooks/use-permission'
import { useSharingAvailability } from '@/hooks/use-sharing'
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  MAX_INVENTORY_WIDTH,
  MIN_INVENTORY_WIDTH,
} from '@/lib/ui-preferences'
import type { UpdateStatus } from '@/lib/update-api'
import type { OnboardingStatus } from '@/lib/onboarding-api'
import type { AuthStatus } from '@/types/auth'
import type { WorkspaceSummary } from '@/lib/workbook-api'
import type { SettingsCategory, SettingsDestination } from '@/types/settings-navigation'
import { cn } from '@/lib/utils'
import {
  DEFAULT_REGISTRY_STATE,
  type PrivateTemplatePack,
  type RegistrySettings,
  type RegistryState,
} from '@/types/registry'

const AccessSettings = lazy(() => import('@/components/settings/access-settings').then((module) => ({ default: module.AccessSettings })))
const NotificationSettings = lazy(() => import('@/components/settings/notifications/notification-settings').then((module) => ({ default: module.NotificationSettings })))
const InventoryMetadataSettings = lazy(() => import('@/components/settings/inventory-metadata/inventory-metadata-settings').then((module) => ({ default: module.InventoryMetadataSettings })))
const SharingSettings = lazy(() => import('@/components/settings/sharing/sharing-settings').then((module) => ({ default: module.SharingSettings })))

type SaveStatus = 'saved' | 'saving' | 'error'

export type SettingsDialogProps = {
  open: boolean
  destination?: SettingsDestination | null
  projectName: string
  projectWorkspaces?: WorkspaceSummary[]
  defaultWorkspaceId?: number
  includesGlobalInventory?: boolean
  useLastActiveWorkspace?: boolean
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
  placementCount: number
  aligningItemsToGrid: boolean
  manualCableBendCount: number
  resettingCableBends: boolean
  manualCableRouteCount: number
  restoringAutomaticCableRoutes: boolean
  updateStatus: UpdateStatus | null
  updateLoading: boolean
  updateChecking: boolean
  updateClearingSkip: boolean
  onboardingStatus: OnboardingStatus | null
  onboardingBusy: boolean
  registry?: RegistryState
  registryLoading?: boolean
  registrySaving?: boolean
  onOpenChange: (open: boolean) => void
  onProjectNameChange: (name: string) => void
  onDefaultWorkspaceChange?: (workspaceId: number) => void
  onIncludesGlobalInventoryChange?: (enabled: boolean) => void
  onUseLastActiveWorkspaceChange?: (enabled: boolean) => void
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
  onAlignAllItemsToGrid: () => void
  onResetAllCableBends: () => void
  onRestoreAutomaticCableRoutes: () => void
  onResetBrowserPreferences: () => void
  onClearIgnoredWarnings: () => void
  onEnableCompatibilityForAllHosts: () => void
  onCheckForUpdates: () => void
  onClearSkippedUpdate: () => void
  onExploreExample: () => void
  onReviewExample: () => void
  onRestartOnboarding: () => void
  onDismissOnboarding: () => void
  onRegistrySettingsChange?: (
    settings: Partial<Pick<RegistrySettings, 'mode' | 'defaultInventorySource' | 'automaticContributions' | 'automaticSafeUpdates' | 'showRegistryLinkIndicators'>>,
    expectedUpdatedAt: string | null,
  ) => void | Promise<void>
  onDeletePrivateTemplate?: (id: number) => void | Promise<void>
  onExportPrivateTemplates?: () => Promise<PrivateTemplatePack>
  onImportPrivateTemplates?: (pack: unknown) => Promise<{ imported: number; skipped: number }>
  onImportOfficialCatalog?: (artifact: unknown) => Promise<void>
  onRefreshOfficialCatalog?: () => Promise<void>
  onApplyCatalogUpdate?: (linkId: number) => Promise<void>
  onDeliverRegistryContributions?: () => Promise<void>
  onRevokeRegistryContributions?: () => Promise<void>
  onRotateRegistryContributionKey?: () => Promise<void>
  onResumeRegistryContributionRecovery?: () => Promise<void>
  onResetRegistryContributionRecovery?: () => Promise<void>
}

const categories: Array<{
  id: SettingsCategory
  label: string
  description: string
  icon: typeof Settings
}> = [
  { id: 'general', label: 'General', description: 'Browser workspace preferences', icon: MonitorCog },
  { id: 'project', label: 'Project', description: 'Shared project configuration', icon: FolderCog },
  { id: 'authentication', label: 'Authentication', description: 'Login methods and identities', icon: ShieldCheck },
  { id: 'access', label: 'Access', description: 'Users, invitations, and roles', icon: UsersRound },
  { id: 'inventory-metadata', label: 'Inventory metadata', description: 'Custom fields and tags', icon: Tags },
  { id: 'registry', label: 'Registry', description: 'Catalog and private templates', icon: Database },
  { id: 'sharing', label: 'Sharing', description: 'Publish selected views to lab.gd', icon: Share2 },
  { id: 'notifications', label: 'Notifications', description: 'Destinations, rules, and incidents', icon: BellRing },
  { id: 'backup-restore', label: 'Backup & Restore', description: 'Portable data protection', icon: ArchiveRestore },
  { id: 'updates', label: 'Updates', description: 'Image channel and status', icon: RefreshCw },
  { id: 'feedback', label: 'Feedback', description: 'Roadmap, ideas, and issues', icon: MessageSquarePlus },
  { id: 'about', label: 'About', description: 'Purpose, version, and links', icon: Info },
]

export function visibleSettingsCategories(status: AuthStatus | null, sharingAvailable = false): typeof categories {
  return categories.filter((category) => {
    if (['general', 'authentication', 'feedback', 'about'].includes(category.id)) return true
    if (category.id === 'access') {
      return status?.mode !== 'disabled'
        && (hasPermission(status, 'users.view') || hasPermission(status, 'roles.view'))
    }
    if (category.id === 'project') return hasPermission(status, 'project.view')
    if (category.id === 'inventory-metadata') return hasPermission(status, 'inventory.view')
    if (category.id === 'registry') return hasPermission(status, 'registry.view')
    if (category.id === 'sharing') return sharingAvailable && hasPermission(status, 'sharing.configure')
    if (category.id === 'notifications') return hasPermission(status, 'notifications.view')
    if (category.id === 'backup-restore') return hasPermission(status, 'backups.view')
    if (category.id === 'updates') return hasPermission(status, 'updates.view')
    return false
  })
}

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
  availableCategories,
}: {
  active: SettingsCategory
  onChange: (category: SettingsCategory) => void
  availableCategories: typeof categories
}) {
  return (
    <nav className="hidden border-r border-[#e2dbcf] bg-[#f5f1ea] p-3 lg:block" aria-label="Settings categories">
      <div className="grid gap-1">
        {availableCategories.map((category) => {
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
  availableCategories,
}: {
  active: SettingsCategory
  onChange: (category: SettingsCategory) => void
  availableCategories: typeof categories
}) {
  return (
    <div className="border-b border-[#e2dbcf] bg-[#f5f1ea] px-4 py-3 lg:hidden">
      <Select value={active} onValueChange={(value) => onChange(value as SettingsCategory)}>
        <SelectTrigger className="h-10 w-full bg-white" aria-label="Settings category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableCategories.map((category) => (
            <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function GeneralSettings(props: SettingsDialogProps) {
  const canEditCanvas = usePermission('canvas.edit')
  const canEditConnections = usePermission('connections.edit')

  return (
    <SettingsSection title="General" description="Browser controls and shared settings for this Canvas workspace.">
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
      <SettingRow
        label="Align all equipment to grid"
        description={props.placementCount > 0
          ? `${props.placementCount} equipment item${props.placementCount === 1 ? '' : 's'} will move to the nearest collision-free 24 px grid positions.`
          : 'No equipment is currently placed on the canvas.'}
      >
        <ConfirmSettingsAction
          title="Align all equipment to grid?"
          description={`This starts with the upper-left equipment item, works left to right and then downward, and moves blocking items recursively to the nearest open grid positions. All ${props.placementCount} placement${props.placementCount === 1 ? '' : 's'} update together, and one Undo restores the previous layout.`}
          actionLabel={props.aligningItemsToGrid ? 'Aligning equipment' : 'Align equipment'}
          onConfirm={props.onAlignAllItemsToGrid}
          disabled={!canEditCanvas || !props.snapItemsToGrid || props.placementCount === 0 || props.aligningItemsToGrid}
        />
      </SettingRow>
      <SettingRow
        label="Reset all cable bends"
        description={props.manualCableBendCount > 0
          ? `${props.manualCableBendCount} cable${props.manualCableBendCount === 1 ? '' : 's'} currently use saved manual bends.`
          : 'No cables currently use saved manual bends.'}
      >
        <ConfirmSettingsAction
          title="Reset all cable bends?"
          description={`This removes saved manual bend points from ${props.manualCableBendCount} cable${props.manualCableBendCount === 1 ? '' : 's'} and lets automatic routing rebuild only the affected routes. Cable endpoint sides and collision preferences remain unchanged. One Undo restores every removed bend.`}
          actionLabel={props.resettingCableBends ? 'Resetting bends' : 'Reset cable bends'}
          onConfirm={props.onResetAllCableBends}
          disabled={!canEditConnections || props.manualCableBendCount === 0 || props.resettingCableBends}
        />
      </SettingRow>
      <SettingRow
        label="Restore automatic cable routes"
        description={props.manualCableRouteCount > 0
          ? `${props.manualCableRouteCount} cable${props.manualCableRouteCount === 1 ? '' : 's'} currently use manual bends or endpoint sides.`
          : 'Every cable currently uses automatic geometry.'}
      >
        <ConfirmSettingsAction
          title="Restore automatic cable routes?"
          description={`This removes saved bend points and endpoint-side overrides from ${props.manualCableRouteCount} cable${props.manualCableRouteCount === 1 ? '' : 's'}. Automatic routing will choose the shortest valid attachment sides while preserving collision preferences. One Undo restores the previous routes.`}
          actionLabel={props.restoringAutomaticCableRoutes ? 'Restoring routes' : 'Restore automatic routes'}
          onConfirm={props.onRestoreAutomaticCableRoutes}
          disabled={!canEditConnections || props.manualCableRouteCount === 0 || props.restoringAutomaticCableRoutes}
        />
      </SettingRow>
      <SettingRow label="Reset workspace preferences" description="Restore this browser's controls and the current Canvas workspace settings to their defaults.">
        <ConfirmSettingsAction
          title="Reset workspace preferences?"
          description="Browser layout controls and shared settings for this Canvas workspace will return to their defaults. Inventory and topology are not changed."
          actionLabel="Reset preferences"
          onConfirm={props.onResetBrowserPreferences}
        />
      </SettingRow>
    </SettingsSection>
  )
}

function ProjectSettings(props: SettingsDialogProps) {
  const canEditWorkspace = usePermission('workspace.edit')
  const canManageProject = usePermission('project.settings.manage')
  const canResolveAudit = usePermission('audit.manage')
  const onboarding = props.onboardingStatus?.enabled ? props.onboardingStatus : null
  const onboardingLabel = onboarding?.status === 'sample_active'
    ? 'Example workspace active'
    : onboarding?.status === 'completed'
      ? 'Checklist complete'
      : onboarding?.status === 'dismissed'
        ? 'Guidance dismissed'
        : onboarding?.status === 'checklist_active'
          ? 'Checklist active'
          : 'Available'

  return (
    <SettingsSection title="Project" description="Shared settings saved with this inventory project.">
      <SettingRow label="Project name" description={`Autosave status: ${saveStatusLabel(props.saveStatus)}`}>
        <Input
          aria-label="Project name"
          value={props.projectName}
          disabled={!canManageProject}
          onChange={(event) => props.onProjectNameChange(event.target.value)}
          className="w-full sm:w-[320px]"
        />
      </SettingRow>
      {props.projectWorkspaces?.length ? (
        <SettingRow label="Default tab" description="Opened when this project is selected unless this browser uses its last active tab.">
          <Select
            value={String(props.defaultWorkspaceId ?? props.projectWorkspaces[0].id)}
            disabled={!canManageProject}
            onValueChange={(value) => props.onDefaultWorkspaceChange?.(Number(value))}
          >
            <SelectTrigger className="w-full bg-white sm:w-[260px]" aria-label="Default project tab"><SelectValue /></SelectTrigger>
            <SelectContent>
              {props.projectWorkspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={String(workspace.id)}>{workspace.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      ) : null}
      {props.onIncludesGlobalInventoryChange ? (
        <SettingRow label="Include global inventory" description="Allow explicitly shared equipment to appear in this project.">
          <Switch
            aria-label="Include global inventory"
            checked={props.includesGlobalInventory ?? true}
            disabled={!canManageProject}
            onCheckedChange={props.onIncludesGlobalInventoryChange}
          />
        </SettingRow>
      ) : null}
      {props.onUseLastActiveWorkspaceChange ? (
        <SettingRow label="Use last active tab" description="Browser-only. Reopen the last tab used in each project instead of its configured default.">
          <Switch
            aria-label="Use last active tab"
            checked={props.useLastActiveWorkspace ?? false}
            onCheckedChange={props.onUseLastActiveWorkspaceChange}
          />
        </SettingRow>
      ) : null}
      {onboarding ? (
        <SettingRow label="Getting started" description={`${onboardingLabel}. Progress is stored with this project.`}>
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            {onboarding.status === 'sample_active' ? (
              <Button type="button" variant="outline" onClick={props.onReviewExample} disabled={!canEditWorkspace || props.onboardingBusy}>
                Review example
              </Button>
            ) : null}
            {onboarding.eligibleForExample && onboarding.status !== 'sample_active' ? (
              <Button type="button" variant="outline" onClick={props.onExploreExample} disabled={!canEditWorkspace || props.onboardingBusy}>
                <Play className="size-4" />Explore example
              </Button>
            ) : null}
            {onboarding.status !== 'sample_active' ? (
              <Button type="button" variant="outline" onClick={props.onRestartOnboarding} disabled={!canEditWorkspace || props.onboardingBusy}>
                <RotateCcw className="size-4" />Restart checklist
              </Button>
            ) : null}
            {onboarding.status === 'checklist_active' ? (
              <Button type="button" variant="ghost" onClick={props.onDismissOnboarding} disabled={!canEditWorkspace || props.onboardingBusy}>Dismiss</Button>
            ) : null}
          </div>
        </SettingRow>
      ) : null}
      <SettingRow label="Ignored audit findings" description="Restore individually ignored findings to the active audit when they still apply.">
        <ConfirmSettingsAction
          title="Clear ignored audit findings?"
          description="Previously ignored findings will return to the active audit if they still apply. Host compatibility opt-outs remain unchanged."
          actionLabel="Clear ignored findings"
          onConfirm={props.onClearIgnoredWarnings}
          disabled={!canResolveAudit}
        />
      </SettingRow>
      <SettingRow label="Host compatibility checks" description="Remove all server and NAS compatibility opt-outs in this project.">
        <ConfirmSettingsAction
          title="Enable compatibility checks for all hosts?"
          description="Compatibility checks will be re-enabled for every server and NAS. Ignored individual findings remain unchanged."
          actionLabel="Enable for all hosts"
          onConfirm={props.onEnableCompatibilityForAllHosts}
          disabled={!canManageProject}
        />
      </SettingRow>
    </SettingsSection>
  )
}

function RegistrySettingsPanel(props: SettingsDialogProps) {
  const canManageRegistry = usePermission('registry.manage')
  const canContributeRegistry = usePermission('registry.contribute')
  const registry = props.registry ?? DEFAULT_REGISTRY_STATE
  const policy = registry.policy ?? DEFAULT_REGISTRY_STATE.policy!
  const effectiveMode = policy.forcedMode ?? registry.settings.mode
  const contributions = registry.contributions ?? DEFAULT_REGISTRY_STATE.contributions
  const database = registry.database ?? DEFAULT_REGISTRY_STATE.database
  const inputRef = useRef<HTMLInputElement>(null)
  const catalogInputRef = useRef<HTMLInputElement>(null)
  const [transferStatus, setTransferStatus] = useState<string | null>(null)
  const [contributionError, setContributionError] = useState<string | null>(null)
  const busy = props.registryLoading === true || props.registrySaving === true

  async function update(settings: Parameters<NonNullable<SettingsDialogProps['onRegistrySettingsChange']>>[0]) {
    const contributionUpdate = settings.automaticContributions !== undefined
    setTransferStatus(null)
    setContributionError(null)
    try {
      await props.onRegistrySettingsChange?.(settings, registry.settings.updatedAt)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registry settings could not be updated.'
      if (contributionUpdate) setContributionError(message)
      else setTransferStatus(message)
    }
  }

  async function exportTemplates() {
    if (!props.onExportPrivateTemplates) return
    setTransferStatus(null)
    try {
      const pack = await props.onExportPrivateTemplates()
      const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `homelab-inventory-private-templates-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setTransferStatus(`Exported ${pack.templates.length} private template${pack.templates.length === 1 ? '' : 's'}.`)
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : 'Private templates could not be exported.')
    }
  }

  async function importTemplates(file: File | undefined) {
    if (!file || !props.onImportPrivateTemplates) return
    setTransferStatus(null)
    try {
      const result = await props.onImportPrivateTemplates(JSON.parse(await file.text()))
      setTransferStatus(`Imported ${result.imported}; skipped ${result.skipped} existing template${result.skipped === 1 ? '' : 's'}.`)
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : 'Private templates could not be imported.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function importCatalog(file: File | undefined) {
    if (!file || !props.onImportOfficialCatalog) return
    setTransferStatus(null)
    try {
      await props.onImportOfficialCatalog(JSON.parse(await file.text()))
      setTransferStatus('Verified official catalog snapshot imported.')
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : 'Official catalog could not be imported.')
    } finally {
      if (catalogInputRef.current) catalogInputRef.current.value = ''
    }
  }

  async function refreshCatalog() {
    if (!props.onRefreshOfficialCatalog) return
    setTransferStatus(null)
    try {
      await props.onRefreshOfficialCatalog()
      setTransferStatus('Official catalog is up to date.')
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : 'Official catalog could not be refreshed.')
    }
  }

  async function deliverContributions() {
    if (!props.onDeliverRegistryContributions) return
    setTransferStatus(null)
    try {
      await props.onDeliverRegistryContributions()
      setTransferStatus('Catalog contributions are up to date.')
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : 'Catalog contributions could not be delivered.')
    }
  }

  async function resumeContributionRecovery() {
    if (!props.onResumeRegistryContributionRecovery) return
    setContributionError(null)
    try {
      await props.onResumeRegistryContributionRecovery()
      setTransferStatus('Registry installation recovery is active.')
    } catch (error) {
      setContributionError(error instanceof Error ? error.message : 'Registry installation recovery is still pending.')
    }
  }

  const enrollmentDescription = contributions.enrollment === 'active'
    ? 'This installation is enrolled with a backend-only signing key.'
    : contributions.enrollment === 'recovery-pending'
      ? 'A replacement signing key is waiting for owner approval in the registry.'
      : contributions.enrollment === 'rejected'
        ? 'The registry owner rejected this signing-key recovery request.'
        : contributions.enrollment === 'revoked'
          ? 'Registry enrollment has been revoked.'
          : 'This installation is not enrolled.'

  return (
    <SettingsSection title="Registry" description="Choose how this installation finds reusable hardware definitions.">
      <SettingRow
        label="Registry mode"
        description={policy.modeLocked
          ? 'Connected mode is enforced by public demo policy so visitors can browse the verified official catalog.'
          : 'Disabled makes no registry requests. Offline uses a manually imported signed catalog. Connected will synchronize the official catalog.'}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full sm:w-[260px]" tabIndex={policy.modeLocked ? 0 : -1}>
              <Select value={effectiveMode} disabled={busy || policy.modeLocked || !canManageRegistry} onValueChange={(mode) => void update({ mode: mode as RegistrySettings['mode'] })}>
                <SelectTrigger className="w-full" aria-label="Registry mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="offline">Offline file</SelectItem>
                  <SelectItem value="connected">Connected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TooltipTrigger>
          {policy.modeLocked ? (
            <TooltipContent side="top" sideOffset={6} className="max-w-sm leading-5">
              Read-only because connected catalog access is enforced by public demo policy.
            </TooltipContent>
          ) : null}
        </Tooltip>
      </SettingRow>
      <SettingRow label="Default Add Hardware tab" description="Unavailable catalog sources fall back to Manual without changing this preference.">
        <Select value={registry.settings.defaultInventorySource} disabled={busy || !canManageRegistry} onValueChange={(defaultInventorySource) => void update({ defaultInventorySource: defaultInventorySource as RegistrySettings['defaultInventorySource'] })}>
          <SelectTrigger className="w-full sm:w-[260px]" aria-label="Default Add Hardware tab"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="catalog">Catalog</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="private-templates">Private templates</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label="Automatically apply safe official updates"
        description="Apply signed official catalog changes only when compatibility, occupied slots, ports, assignments, and connections remain valid. Other updates stay available for review."
      >
        <Switch
          aria-label="Automatically apply safe official updates"
          checked={registry.settings.automaticSafeUpdates}
          disabled={busy || effectiveMode !== 'connected' || policy.automaticSafeUpdatesForced || !canManageRegistry}
          onCheckedChange={(automaticSafeUpdates) => void update({ automaticSafeUpdates })}
        />
      </SettingRow>
      <SettingRow
        label="Show registry link indicators"
        description="Mark registry-linked equipment and assigned components on the canvas. Hidden by default."
      >
        <Switch
          aria-label="Show registry link indicators"
          checked={registry.settings.showRegistryLinkIndicators}
          disabled={busy || !canManageRegistry}
          onCheckedChange={(showRegistryLinkIndicators) => void update({ showRegistryLinkIndicators })}
        />
      </SettingRow>
      <SettingRow
        label="Automatic catalog contributions"
        description={policy.contributionsAllowed
          ? 'Explicit opt-in. The backend sends only reusable, allowlisted hardware definitions after removing local device names, addresses, serials, notes, topology, assignments, agents, and smart-device instance data. Inventory saves never wait for delivery.'
          : 'Disabled by public demo policy. Demo inventory is disposable and never enrolls with or sends candidates to the registry.'}
      >
        <div className="flex max-w-[280px] flex-col items-end gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div tabIndex={!policy.contributionsAllowed ? 0 : -1}>
                <Switch
                  aria-label="Automatic catalog contributions"
                  aria-describedby={contributionError ? 'registry-contribution-error' : undefined}
                  checked={policy.contributionsAllowed && registry.settings.automaticContributions}
                  disabled={busy || effectiveMode !== 'connected' || !policy.contributionsAllowed || !canManageRegistry}
                  onCheckedChange={(automaticContributions) => void update({ automaticContributions })}
                />
              </div>
            </TooltipTrigger>
            {!policy.contributionsAllowed ? (
              <TooltipContent side="top" sideOffset={6} className="max-w-sm leading-5">
                Read-only because automatic contributions are prohibited by public demo policy.
              </TooltipContent>
            ) : null}
          </Tooltip>
          {contributionError ? (
            <p
              id="registry-contribution-error"
              role="alert"
              className="text-right text-xs font-semibold leading-5 text-[#9b3f32]"
            >
              {contributionError}
            </p>
          ) : null}
        </div>
      </SettingRow>
      {policy.contributionsAllowed ? <div className="border-t border-[#e8e1d6] p-4">
        <div className="grid gap-3 rounded-md border border-[#ded5c8] bg-[#f8f4ed] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <h3 className="text-sm font-black text-[#28231f]">Contribution delivery</h3>
            <p className="mt-1 text-xs leading-5 text-[#756d62]">
              {enrollmentDescription}
              {' '}{contributions.queued} queued, {contributions.retrying} retrying, {contributions.delivered} delivered, and {contributions.suppressed} suppressed.
            </p>
            {contributions.clientInstanceId ? <p className="mt-1 break-all font-mono text-[11px] text-[#756d62]">Installation {contributions.clientInstanceId}</p> : null}
            {contributions.recoveryKey ? <p className="mt-1 break-all font-mono text-[11px] text-[#756d62]">Recovery {contributions.recoveryKey}</p> : null}
            {contributions.lastError ? <p className="mt-1 text-xs font-semibold text-[#9b3f32]">{contributions.lastError}</p> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={
                effectiveMode !== 'connected'
                || contributions.enrollment !== 'active'
                || busy
                || !canContributeRegistry
                || !props.onDeliverRegistryContributions
              }
              onClick={() => void deliverContributions()}
            >
              Send now
            </Button>
            {canContributeRegistry && contributions.enrollment === 'active' && props.onRevokeRegistryContributions ? (
              <ConfirmSettingsAction
                title="Revoke registry enrollment?"
                description="Automatic contributions will stop and the registry token will be revoked. The local signing key remains available for a deliberate future re-enrollment."
                actionLabel="Revoke enrollment"
                onConfirm={props.onRevokeRegistryContributions}
              />
            ) : null}
            {canContributeRegistry && contributions.enrollment === 'active' && props.onRotateRegistryContributionKey ? (
              <ConfirmSettingsAction
                title="Rotate installation signing key?"
                description="The registry will authenticate the current installation before replacing its backend-only Ed25519 key. The current key and credentials remain unchanged if rotation fails."
                actionLabel="Rotate key"
                onConfirm={props.onRotateRegistryContributionKey}
              />
            ) : null}
            {canContributeRegistry && contributions.enrollment === 'recovery-pending' && props.onResumeRegistryContributionRecovery ? (
              <Button type="button" variant="outline" onClick={() => void resumeContributionRecovery()}>
                Check approval
              </Button>
            ) : null}
            {canContributeRegistry && contributions.enrollment === 'rejected' && props.onResetRegistryContributionRecovery ? (
              <ConfirmSettingsAction
                title="Reset rejected enrollment recovery?"
                description="This removes the rejected replacement key from this installation. The stable installation identifier remains unchanged, and automatic contributions stay disabled until you enroll again."
                actionLabel="Reset recovery"
                onConfirm={props.onResetRegistryContributionRecovery}
              />
            ) : null}
          </div>
        </div>
      </div> : null}
      <div className="border-t border-[#e8e1d6] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-[#28231f]">Official catalog source</h3>
            <p className="mt-0.5 text-xs text-[#756d62]">Signed snapshots are verified before replacing the last-known-good local catalog.</p>
          </div>
          <div className="flex gap-2">
            <input ref={catalogInputRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import signed official catalog" onChange={(event) => void importCatalog(event.target.files?.[0])} />
            {effectiveMode === 'offline' ? <Button type="button" variant="outline" onClick={() => catalogInputRef.current?.click()} disabled={busy || !canManageRegistry || !props.onImportOfficialCatalog}>Import snapshot</Button> : null}
            {effectiveMode === 'connected' ? <Button type="button" variant="outline" onClick={() => void refreshCatalog()} disabled={busy || !canManageRegistry || !props.onRefreshOfficialCatalog}>Refresh now</Button> : null}
          </div>
        </div>
      <CatalogSourceStatus registry={registry} />
      <SettingRow
        label="Data schema"
        description={database.lastMigration
          ? `Last migrated from schema ${database.lastMigration.from} to ${database.lastMigration.to} on ${new Date(database.lastMigration.completedAt).toLocaleString()}.`
          : 'No migration has been recorded for this data directory.'}
      >
        <div className="text-right text-sm font-semibold">
          <div>Schema {database.schemaVersion ?? 'unknown'}</div>
          {database.lastMigration?.backupId ? (
            <div className="mt-1 max-w-64 truncate text-xs font-normal text-muted-foreground" title={database.lastMigration.backupId}>
              Backup {database.lastMigration.backupId}
            </div>
          ) : null}
        </div>
      </SettingRow>
      </div>
      <SettingRow label="Private templates" description={`${registry.privateTemplates.length} reusable local template${registry.privateTemplates.length === 1 ? '' : 's'}. These never leave this installation automatically.`}>
        <div className="flex flex-wrap justify-end gap-2">
          <input ref={inputRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import private templates file" onChange={(event) => void importTemplates(event.target.files?.[0])} />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={!canManageRegistry || !props.onImportPrivateTemplates}>Import</Button>
          <Button type="button" variant="outline" onClick={() => void exportTemplates()} disabled={!canManageRegistry || !props.onExportPrivateTemplates || registry.privateTemplates.length === 0}>Export all</Button>
        </div>
      </SettingRow>
      {transferStatus ? <div className="border-t border-[#e8e1d6] bg-[#f7f2e9] px-4 py-3 text-sm text-[#554b40]">{transferStatus}</div> : null}
      {registry.privateTemplates.map((template) => (
        <SettingRow key={template.id} label={template.name} description={`${template.item.name} · ${template.item.type}`}>
          {canManageRegistry && props.onDeletePrivateTemplate ? (
            <ConfirmSettingsAction
              title={`Delete ${template.name}?`}
              description="This removes only the reusable private template. Existing inventory items are not changed."
              actionLabel="Delete template"
              onConfirm={() => props.onDeletePrivateTemplate?.(template.id)}
            />
          ) : null}
        </SettingRow>
      ))}
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

function FeedbackSettings(props: SettingsDialogProps) {
  const version = props.updateStatus?.runningVersion ?? 'unknown'
  const proposalUrl = `https://homelabinventory.com/roadmap/propose?source=self-hosted-app&version=${encodeURIComponent(version)}`

  return (
    <SettingsSection title="Feedback" description="Help shape Homelab Inventory without sharing inventory records or diagnostics.">
      <SettingRow label="Propose a feature" description="Submit an idea for private review before it appears on the public roadmap.">
        <Button asChild variant="outline"><a href={proposalUrl} target="_blank" rel="noreferrer"><Lightbulb className="size-4" />Propose feature</a></Button>
      </SettingRow>
      <SettingRow label="Report a bug" description="Open the GitHub issue form. Remove private addresses, serial numbers, and credentials before submitting.">
        <Button asChild variant="outline"><a href="https://github.com/mriverodorta/homelab-inventory/issues/new/choose" target="_blank" rel="noreferrer"><Bug className="size-4" />Report bug</a></Button>
      </SettingRow>
      <SettingRow label="Community roadmap" description="Review approved proposals, vote once with GitHub, and join linked discussions.">
        <Button asChild variant="outline"><a href="https://homelabinventory.com/roadmap" target="_blank" rel="noreferrer"><Map className="size-4" />View roadmap</a></Button>
      </SettingRow>
      <div className="border-t border-[#e8e1d6] bg-[#f7f2e9] px-4 py-3 text-xs leading-5 text-[#665d52]">
        Feedback links include only the public app version and a self-hosted-app source label. Project data is never attached.
      </div>
    </SettingsSection>
  )
}

export function SettingsDialog(props: SettingsDialogProps) {
  const auth = useAuth()
  const [category, setCategory] = useState<SettingsCategory>('general')
  const canConfigureSharing = hasPermission(auth.status, 'sharing.configure')
  const sharingAvailability = useSharingAvailability(props.open && canConfigureSharing)
  const availableCategories = visibleSettingsCategories(auth.status, sharingAvailability.data?.available === true)
  const activeCategory = availableCategories.some((entry) => entry.id === category) ? category : 'general'

  useEffect(() => {
    if (!props.open || !props.destination) return
    setCategory(props.destination.category)
  }, [props.destination, props.open])

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
          <CategoryNavigation active={activeCategory} onChange={setCategory} availableCategories={availableCategories} />
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
            <MobileCategorySelector active={activeCategory} onChange={setCategory} availableCategories={availableCategories} />
            <main className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6" aria-live="polite">
              {activeCategory === 'general' ? <GeneralSettings {...props} /> : null}
              {activeCategory === 'project' ? <ProjectSettings {...props} /> : null}
              {activeCategory === 'authentication' ? <AuthenticationSettings /> : null}
              {activeCategory === 'access' ? <Suspense fallback={<div className="grid min-h-52 place-items-center text-sm font-bold text-[#756d62]">Loading access policy…</div>}><AccessSettings /></Suspense> : null}
              {activeCategory === 'inventory-metadata' ? (
                <Suspense fallback={<div className="grid min-h-52 place-items-center text-sm font-bold text-[#756d62]">Loading inventory metadata…</div>}>
                  <InventoryMetadataSettings
                    requestedTab={props.destination?.inventoryMetadataTab}
                    requestId={props.destination?.requestId}
                  />
                </Suspense>
              ) : null}
              {activeCategory === 'registry' ? <RegistrySettingsPanel {...props} /> : null}
              {activeCategory === 'sharing' ? <Suspense fallback={<div className="grid min-h-52 place-items-center text-sm font-bold text-[#756d62]">Loading sharing…</div>}><SharingSettings /></Suspense> : null}
              {activeCategory === 'notifications' ? <Suspense fallback={<div className="grid min-h-52 place-items-center text-sm font-bold text-[#756d62]">Loading notifications…</div>}><NotificationSettings /></Suspense> : null}
              {activeCategory === 'backup-restore' ? <BackupRestoreSettings /> : null}
              {activeCategory === 'updates' ? <UpdateSettings {...props} /> : null}
              {activeCategory === 'feedback' ? <FeedbackSettings {...props} /> : null}
              {activeCategory === 'about' ? <AboutSettings {...props} /> : null}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { categories as SETTINGS_CATEGORIES }
