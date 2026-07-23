function itemRef(project, runtimeKey, label) {
  const item = project.items[runtimeKey]
  if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.type !== 'string') {
    throw new TypeError(`${label} references missing inventory item ${String(runtimeKey)}.`)
  }
  return { item_type: item.type, id: item.id }
}

function endpointRef(project, endpoint, label) {
  return {
    item: itemRef(project, endpoint.itemId, `${label}.itemId`),
    port_id: endpoint.portId,
    endpoint_id: endpoint.endpointId ?? null,
    hosted_item: endpoint.hostedItemId
      ? itemRef(project, endpoint.hostedItemId, `${label}.hostedItemId`)
      : null,
  }
}

function topologyRoute(route) {
  if (!route) return null
  return {
    source_side: route.sourceSide ?? null,
    target_side: route.targetSide ?? null,
    bend_points: (route.bendPoints ?? []).map((point) => ({ x: point.x, y: point.y })),
    avoid_cable_overlap: route.avoidCableOverlap === true,
  }
}

export function createEngineSnapshot(project) {
  return {
    revision: project.revision,
    project_name: project.metadata.name,
    topology: {
      items: Object.values(project.items).map((item) => ({
        item: { item_type: item.type, id: item.id },
        archived: typeof item.archivedAt === 'string' && item.archivedAt.length > 0,
        power_configuration: typeof item.specs?.powerConfiguration === 'string'
          ? item.specs.powerConfiguration
          : null,
        allow_outlet_fan_out: item.specs?.allowOutletFanOut === true,
        ports: (item.ports ?? []).map((port) => ({
          id: port.id,
          key: port.key ?? null,
          port_type: port.type,
          slot_number: port.slotNumber,
          speed: port.speed ?? null,
          endpoints: (port.endpoints ?? []).map((endpoint) => ({
            id: endpoint.id,
            side: endpoint.side,
          })),
        })),
      })),
      assignments: project.assignments.map((assignment, index) => ({
        id: assignment.id,
        host: itemRef(project, assignment.serverId, `assignments[${String(index)}].serverId`),
        item: itemRef(project, assignment.itemId, `assignments[${String(index)}].itemId`),
        component_type: assignment.type,
      })),
      connections: project.connections.map((connection, index) => ({
        id: connection.id,
        from: endpointRef(project, connection.from, `connections[${String(index)}].from`),
        to: endpointRef(project, connection.to, `connections[${String(index)}].to`),
        connection_type: connection.type,
        negotiated_speed_mbps: connection.negotiatedSpeedMbps ?? null,
        label: connection.label ?? null,
        route: topologyRoute(connection.route),
        created_at: connection.createdAt,
      })),
      placements: project.placements.map((placement, index) => (
        itemRef(project, placement.serverId, `placements[${String(index)}].serverId`)
      )),
    },
  }
}

