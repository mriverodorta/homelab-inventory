import { useContext, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Cable } from 'lucide-react'
import { InspectorConnectionSelectionContext } from '@/components/inspector/connections/connection-selection-context'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { InspectorTopologyContext } from '@/components/inspector/inspector-topology-context'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCompatibleTopologyDestinations } from '@/hooks/use-topology-query'
import { describeConnectionEndpoint, getCableAppearance } from '@/lib/cables'
import { getEndpointGroupForHost, getHostEndpointGroups } from '@/lib/connection-endpoints'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import { cn } from '@/lib/utils'
import type {
  ConnectionEndpoint,
  ConnectionRoutePreferences,
  ConnectionRouteSide,
  InventoryConnection,
  InventoryItem,
  ProjectState,
} from '@/types/inventory'

const EMPTY_SELECT_VALUE = '__empty__'
const CONNECTION_ROUTE_SIDE_OPTIONS: ConnectionRouteSide[] = ['top', 'right', 'bottom', 'left']
const inspectorSurfaceClass = 'border-[#e3d7c8] bg-[#fffdf8] shadow-[0_16px_34px_rgba(60,52,43,0.08)]'
const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'
const formLabelClass = 'grid gap-1.5 text-sm font-semibold text-[#20242c]'

export function ConnectionEditor({
  project,
  item,
  onCreate,
  onUpdateLabel,
  onRemove,
}: {
  project: ProjectState
  item: InventoryItem
  onCreate: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
  onUpdateLabel: (connectionId: string | number, label: string) => void
  onRemove: (connectionId: string | number) => void
}) {
  const topology = useContext(InspectorTopologyContext)
  const selectedEndpointGroup = useMemo(
    () => getEndpointGroupForHost(project, item, topology.data?.power.endpoints),
    [item, project, topology.data],
  )
  const selectedEndpointOptions = useMemo(
    () => selectedEndpointGroup?.options ?? [],
    [selectedEndpointGroup],
  )
  const availableFromOptions = useMemo(
    () =>
      selectedEndpointOptions.filter((option) => topology.data?.endpoints.some(
        (descriptor) => descriptor.available && endpointKey(descriptor.endpoint) === option.key,
      )),
    [selectedEndpointOptions, topology.data],
  )
  const relatedConnections = useMemo(
    () =>
      (project.connections ?? []).filter(
        (connection) =>
          connection.from.itemId === runtimeItemKey(item) ||
          connection.to.itemId === runtimeItemKey(item),
      ),
    [item, project.connections],
  )
  const [fromKey, setFromKey] = useState(EMPTY_SELECT_VALUE)
  const [destinationItemId, setDestinationItemId] = useState(EMPTY_SELECT_VALUE)
  const [toKey, setToKey] = useState(EMPTY_SELECT_VALUE)

  const selectedFrom = availableFromOptions.find((option) => option.key === fromKey) ?? null
  const connectionDestinations = useCompatibleTopologyDestinations(
    project,
    selectedFrom?.endpoint ?? null,
  )
  const destinationGroups = useMemo(
    () => selectedFrom && connectionDestinations.endpointKeys
      ? getHostEndpointGroups(project, topology.data?.power.endpoints)
        .filter((group) => group.key !== runtimeItemKey(selectedFrom.host))
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => connectionDestinations.endpointKeys?.has(option.key)),
        }))
        .filter((group) => group.options.length > 0)
      : [],
    [connectionDestinations.endpointKeys, project, selectedFrom, topology.data],
  )
  const destinationGroup = destinationGroups.find((group) => group.key === destinationItemId) ?? null
  const destinationEndpointOptions = useMemo(
    () => destinationGroup?.options ?? [],
    [destinationGroup],
  )
  const selectedTo = destinationEndpointOptions.find((option) => option.key === toKey) ?? null

  useEffect(() => {
    setFromKey((current) =>
      availableFromOptions.some((option) => option.key === current)
        ? current
        : availableFromOptions[0]?.key ?? EMPTY_SELECT_VALUE,
    )
  }, [availableFromOptions])

  useEffect(() => {
    setDestinationItemId((current) =>
      destinationGroups.some((group) => group.key === current)
        ? current
        : destinationGroups[0]?.key ?? EMPTY_SELECT_VALUE,
    )
  }, [destinationGroups])

  useEffect(() => {
    setToKey((current) =>
      destinationEndpointOptions.some((option) => option.key === current)
        ? current
        : destinationEndpointOptions[0]?.key ?? EMPTY_SELECT_VALUE,
    )
  }, [destinationEndpointOptions])

  if (!topology.data) {
    return (
      <InspectorSection title="Connections" icon={Cable}>
        <p
          role={topology.statusIsError ? 'alert' : 'status'}
          className="text-sm text-[#75695d]"
        >
          {topology.statusMessage ?? 'Loading connection topology...'}
        </p>
      </InspectorSection>
    )
  }

  if (selectedEndpointOptions.length === 0) {
    return null
  }

  return (
    <InspectorSection
      title="Connections"
      icon={Cable}
      badge={relatedConnections.length > 0 ? <StatusBadge tone="success">{relatedConnections.length}</StatusBadge> : undefined}
    >

      {relatedConnections.length > 0 ? (
        <div className="mb-3 space-y-2">
          {relatedConnections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              project={project}
              onUpdateLabel={onUpdateLabel}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : null}

      {availableFromOptions.length > 0 && destinationGroups.length > 0 ? (
        <div className="grid min-w-0 gap-2 rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
          <Select value={fromKey} onValueChange={setFromKey}>
            <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-xs" aria-label="Source port">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(520px,calc(100vw-2rem))]">
              {availableFromOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  <span className="block max-w-[460px] truncate">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={destinationItemId} onValueChange={setDestinationItemId}>
            <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-xs" aria-label="Destination item">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(520px,calc(100vw-2rem))]">
              {destinationGroups.map((group) => (
                <SelectItem key={group.key} value={group.key}>
                  <span className="block max-w-[460px] truncate">{group.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={toKey === EMPTY_SELECT_VALUE ? '' : toKey}
            onValueChange={setToKey}
            disabled={destinationEndpointOptions.length === 0}
          >
            <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-xs" aria-label="Destination port">
              <SelectValue placeholder="No compatible open port" />
            </SelectTrigger>
            <SelectContent className="max-w-[min(520px,calc(100vw-2rem))]">
              {destinationEndpointOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  <span className="block max-w-[460px] truncate">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            className="h-9 w-full"
            disabled={!selectedFrom || !selectedTo}
            onClick={() => {
              if (selectedFrom && selectedTo) {
                onCreate(selectedFrom.endpoint, selectedTo.endpoint)
              }
            }}
          >
            Connect
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#d6ccbd] bg-[#f8f3eb] p-3 text-xs text-[#75695d]">
          No open ports available.
        </div>
      )}
    </InspectorSection>
  )
}

export function ConnectionRow({
  connection,
  project,
  onUpdateLabel,
  onRemove,
}: {
  connection: InventoryConnection
  project: ProjectState
  onUpdateLabel: (connectionId: string | number, label: string) => void
  onRemove: (connectionId: string | number) => void
}) {
  const appearance = getCableAppearance(project, connection)
  const connectionSelection = useContext(InspectorConnectionSelectionContext)

  return (
    <div className="rounded-md border border-[#e5dccf] bg-white p-2.5 text-xs shadow-[0_4px_14px_rgba(60,52,43,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em]"
          style={{ backgroundColor: appearance.color, color: '#fffdf8' }}
        >
          {appearance.label}
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[#75695d]">
          {connection.type}
        </span>
      </div>
      <label className="mb-2 grid gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#75695d]">
        Label
        <Input
          value={connection.label ?? ''}
          placeholder="Cable label"
          className="h-8 text-xs normal-case tracking-normal"
          onChange={(event) => onUpdateLabel(connection.id, event.target.value)}
        />
      </label>
      <div className="space-y-1 text-[#5f554b]">
        <div className="rounded-md bg-[#f8f3eb] p-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#75695d]">From</div>
          <div className="mt-0.5 font-semibold text-[#20242c]">
            {describeConnectionEndpoint(project, connection.from)}
          </div>
        </div>
        <div className="rounded-md bg-[#f8f3eb] p-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#75695d]">To</div>
          <div className="mt-0.5 font-semibold text-[#20242c]">
            {describeConnectionEndpoint(project, connection.to)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => connectionSelection?.onSelectConnection(connection.id)}
        >
          <ArrowUpRight className="size-3.5" />
          Open cable
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onRemove(connection.id)}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

export function ConnectionDetails({
  project,
  connection,
  onUpdateLabel,
  onUpdateRoute,
  onRemove,
}: {
  project: ProjectState
  connection: InventoryConnection
  onUpdateLabel: (connectionId: string | number, label: string) => void
  onUpdateRoute: (connectionId: string | number, route: ConnectionRoutePreferences) => void
  onRemove: (connectionId: string | number) => void
}) {
  const appearance = getCableAppearance(project, connection)
  const route = connection.route ?? {}

  function updateRoute(nextRoute: ConnectionRoutePreferences) {
    onUpdateRoute(connection.id, nextRoute)
  }

  function updateRouteSide(key: 'sourceSide' | 'targetSide', side: ConnectionRouteSide) {
    updateRoute({
      ...route,
      [key]: side,
    })
  }

  function clearBendPoints() {
    updateRoute({
      ...route,
      bendPoints: undefined,
    })
  }

  function removeBendPoint(index: number) {
    const bendPoints = (route.bendPoints ?? []).filter((_, bendIndex) => bendIndex !== index)
    updateRoute({
      ...route,
      bendPoints: bendPoints.length > 0 ? bendPoints : undefined,
    })
  }

  return (
    <Card className={cn(inspectorSurfaceClass, 'overflow-visible rounded-lg')} size="sm">
      <CardHeader className="grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base font-black text-[#20242c]">
            <Cable className="size-4 shrink-0 text-[#75695d]" />
            <span className="truncate">{connection.label?.trim() || 'Cable'}</span>
          </CardTitle>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#75695d]">
            {connection.type}
          </div>
        </div>
        <CardAction>
          <span
            className="inline-flex rounded-md border px-2 py-1 text-xs font-black leading-none"
            style={{
              borderColor: appearance.color,
              color: appearance.color,
            }}
          >
            {appearance.label}
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className={formLabelClass}>
          Label
          <Input
            value={connection.label ?? ''}
            placeholder="Cable label"
            onChange={(event) => onUpdateLabel(connection.id, event.target.value)}
          />
        </label>

        <div className="space-y-3">
          <div className="rounded-md bg-[#f8f3eb] p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
              From
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug text-[#20242c]">
              {describeConnectionEndpoint(project, connection.from)}
            </div>
          </div>
          <div className="rounded-md bg-[#f8f3eb] p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#75695d]">
              To
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug text-[#20242c]">
              {describeConnectionEndpoint(project, connection.to)}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-[#e5dccf] bg-[#fffdf8] p-3">
          <div className={labelClass}>
            Route
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={formLabelClass}>
              From side
              <Select
                value={route.sourceSide}
                disabled={!route.sourceSide}
                onValueChange={(value) => updateRouteSide('sourceSide', value as ConnectionRouteSide)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Resolving..." />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTION_ROUTE_SIDE_OPTIONS.map((side) => (
                    <SelectItem key={side} value={side}>
                      {side[0].toUpperCase() + side.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className={formLabelClass}>
              To side
              <Select
                value={route.targetSide}
                disabled={!route.targetSide}
                onValueChange={(value) => updateRouteSide('targetSide', value as ConnectionRouteSide)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Resolving..." />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTION_ROUTE_SIDE_OPTIONS.map((side) => (
                    <SelectItem key={side} value={side}>
                      {side[0].toUpperCase() + side.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="mt-3 flex items-start justify-between gap-4 rounded-md bg-[#f8f3eb] p-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#20242c]">Avoid other cables</div>
              <div className="mt-0.5 text-xs leading-relaxed text-[#75695d]">
                Uses separate horizontal and vertical lanes. Crossings and shared endpoint approaches remain allowed.
              </div>
            </div>
            <Switch
              className="mt-0.5 shrink-0"
              aria-label="Avoid other cables"
              checked={Boolean(route.avoidCableOverlap)}
              onCheckedChange={(checked) => updateRoute({
                ...route,
                avoidCableOverlap: checked || undefined,
              })}
            />
          </div>
          {route.bendPoints?.length ? (
            <div className="mt-3 space-y-1.5" aria-label="Manual cable bends">
              {route.bendPoints.map((bendPoint, index) => (
                <div
                  key={`${bendPoint.x}:${bendPoint.y}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-md bg-[#f8f3eb] px-2.5 py-2"
                >
                  <span className="min-w-0 text-xs font-semibold text-[#5f554b]">
                    Bend {index + 1}
                    <span className="ml-2 font-mono text-[10px] text-[#8a8175]">
                      {Math.round(bendPoint.x)}, {Math.round(bendPoint.y)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    aria-label={`Remove bend ${index + 1}`}
                    onClick={() => removeBendPoint(index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-8 w-full text-xs"
            disabled={!route.bendPoints?.length}
            onClick={clearBendPoints}
          >
            Reset Bend Points
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-9 w-full"
          onClick={() => onRemove(connection.id)}
        >
          Remove Cable
        </Button>
      </CardContent>
    </Card>
  )
}
