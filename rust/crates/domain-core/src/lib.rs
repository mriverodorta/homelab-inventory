use std::collections::{BTreeMap, BTreeSet};

use homelab_engine_protocol::{
    ArrangementResult, CommandPatchSet, EngineError, EngineRequest, EngineResponse, EngineSnapshot,
    EngineStatus, GeometryHandle, GeometryUpdateResult, NearestPlacementResult, NetworkTraceResult,
    Operation, PROTOCOL_VERSION, PlacementCheckResult, PowerTopologyResult, ProjectPatch,
    ResponseBody, RouteDefinition, RouteEdit, RouteEditResult, RouteResult, RoutesUpdateResult,
    TopologyConnection, TopologyConnectionRoute, TopologyEndpointResult, TopologyError,
    TopologySnapshot,
};
use homelab_geometry::{GeometryError, GeometryNode, SpatialIndex, arrange_items};
use homelab_routing::{
    RoutePlanner, RoutingError, build_route, preview_insert_manual_bend, preview_move_segment,
    preview_remove_manual_bend, preview_reset_route, route_around_obstacles,
};
use homelab_topology::TopologyIndex;

#[derive(Debug, Clone)]
pub struct Engine {
    revision: u32,
    project_name: String,
    geometry_revision: u32,
    geometry: SpatialIndex,
    handles: BTreeMap<String, GeometryHandle>,
    routing_revision: u32,
    routes: BTreeMap<u32, RouteDefinition>,
    route_planner: RoutePlanner,
    topology: TopologyIndex,
}

impl Engine {
    #[must_use]
    pub fn from_snapshot(snapshot: EngineSnapshot) -> Self {
        Self::try_from_snapshot(snapshot).expect("engine snapshot must contain valid topology")
    }

    pub fn try_from_snapshot(snapshot: EngineSnapshot) -> Result<Self, TopologyError> {
        let topology = TopologyIndex::build(snapshot.topology)?;
        Ok(Self {
            revision: snapshot.revision,
            project_name: snapshot.project_name,
            geometry_revision: 0,
            geometry: SpatialIndex::default(),
            handles: BTreeMap::new(),
            routing_revision: 0,
            routes: BTreeMap::new(),
            route_planner: RoutePlanner::default(),
            topology,
        })
    }

    #[must_use]
    pub const fn revision(&self) -> u32 {
        self.revision
    }

    #[must_use]
    pub fn project_name(&self) -> &str {
        &self.project_name
    }

    #[must_use]
    pub const fn geometry_revision(&self) -> u32 {
        self.geometry_revision
    }

    #[must_use]
    pub const fn routing_revision(&self) -> u32 {
        self.routing_revision
    }

    #[must_use]
    pub const fn topology(&self) -> &TopologySnapshot {
        self.topology.snapshot()
    }

    pub fn dispatch(&mut self, request: EngineRequest) -> EngineResponse {
        let base_revision = request.base_revision;
        let request_id = request.request_id;

        if request.protocol_version != PROTOCOL_VERSION {
            return error_response(
                request_id,
                base_revision,
                "protocol-version-mismatch",
                format!(
                    "Protocol version {} is unsupported; expected {PROTOCOL_VERSION}.",
                    request.protocol_version
                ),
            );
        }

        if base_revision != self.revision {
            return error_response(
                request_id,
                base_revision,
                "revision-conflict",
                format!(
                    "Project revision {base_revision} is stale; current revision is {}.",
                    self.revision
                ),
            );
        }

        let result = match request.operation {
            Operation::Status => ResponseBody::Status(EngineStatus {
                revision: self.revision,
                geometry_revision: self.geometry_revision,
                routing_revision: self.routing_revision,
                project_name: self.project_name.clone(),
            }),
            Operation::TopologyEndpoints => {
                ResponseBody::TopologyEndpoints(TopologyEndpointResult {
                    endpoints: self.topology.endpoints(),
                })
            }
            Operation::CompatibleDestinations { source } => {
                ResponseBody::TopologyEndpoints(TopologyEndpointResult {
                    endpoints: self.topology.compatible_destinations(&source),
                })
            }
            Operation::ValidateConnection { from, to } => {
                ResponseBody::ConnectionValidation(self.topology.validate_connection(&from, &to))
            }
            Operation::TraceNetworkPath { start } => {
                ResponseBody::NetworkTrace(NetworkTraceResult {
                    trace: self.topology.trace_network_path(&start),
                })
            }
            Operation::PowerTopology => ResponseBody::PowerTopology(PowerTopologyResult {
                topology: self.topology.power_topology(),
            }),
            Operation::CreateConnection {
                from,
                to,
                created_at,
            } => self.create_connection(from, to, created_at),
            Operation::RemoveConnection { connection_id } => self.remove_connection(connection_id),
            Operation::UpdateConnectionLabel {
                connection_id,
                label,
            } => self.update_connection_label(connection_id, label),
            Operation::UpdateConnectionRoute {
                connection_id,
                route,
            } => self.update_connection_route(connection_id, route),
            Operation::UpdateProjectMetadata { name } => {
                let name = name.trim();
                if name.is_empty() {
                    ResponseBody::Error(EngineError {
                        code: "invalid-project-name".into(),
                        message: "Project name must not be empty.".into(),
                    })
                } else if self.revision == u32::MAX {
                    ResponseBody::Error(EngineError {
                        code: "revision-exhausted".into(),
                        message: "Project revision cannot be advanced safely.".into(),
                    })
                } else {
                    let previous_name = std::mem::replace(&mut self.project_name, name.into());
                    self.revision += 1;
                    ResponseBody::Patch(Box::new(CommandPatchSet {
                        revision: self.revision,
                        forward: ProjectPatch::SetProjectName {
                            name: self.project_name.clone(),
                        },
                        inverse: ProjectPatch::SetProjectName {
                            name: previous_name,
                        },
                    }))
                }
            }
            Operation::ReplaceGeometry { nodes, handles } => self.replace_geometry(nodes, handles),
            Operation::UpdateGeometry {
                upsert_nodes,
                remove_node_ids,
                upsert_handles,
                remove_handle_keys,
            } => self.update_geometry(
                upsert_nodes,
                remove_node_ids,
                upsert_handles,
                remove_handle_keys,
            ),
            Operation::CheckPlacement {
                item_id,
                bounds,
                exclude_item_ids,
            } => self.check_placement(item_id, bounds, exclude_item_ids),
            Operation::CheckGroupMove { moves } => match self.geometry.check_group(&moves) {
                Ok(colliding_item_ids) => ResponseBody::PlacementCheck(PlacementCheckResult {
                    valid: colliding_item_ids.is_empty(),
                    colliding_item_ids,
                }),
                Err(error) => geometry_error(error),
            },
            Operation::FindNearestPlacement {
                item_id,
                preferred,
                clearance,
                step,
                max_rings,
            } => match self
                .geometry
                .nearest_valid(&item_id, preferred, clearance, step, max_rings)
            {
                Ok(bounds) => ResponseBody::NearestPlacement(NearestPlacementResult { bounds }),
                Err(error) => geometry_error(error),
            },
            Operation::ArrangeItems {
                items,
                grid_size,
                column_gap,
                item_gap,
            } => match arrange_items(&items, grid_size, column_gap, item_gap) {
                Ok(nodes) => ResponseBody::Arrangement(ArrangementResult { nodes }),
                Err(error) => geometry_error(error),
            },
            Operation::ReplaceRoutes { routes } => self.replace_routes(routes),
            Operation::BuildRoute { connection_id } => {
                match self.route(connection_id).and_then(build_route) {
                    Ok(route) => ResponseBody::Route(RouteResult { route }),
                    Err(error) => routing_error(error),
                }
            }
            Operation::RouteAroundObstacles { request } => match route_around_obstacles(&request) {
                Ok(result) => ResponseBody::ObstacleRoute(result),
                Err(error) => routing_error(error),
            },
            Operation::PlanCableRoutes { plan } => match self.route_planner.plan(&plan) {
                Ok(result) => ResponseBody::CableRoutesPlanned(result),
                Err(error) => routing_error(error),
            },
            Operation::PreviewPlannedRouteSegment {
                connection_id,
                segment_index,
                coordinate,
                snap_grid,
                endpoint_snap_threshold,
            } => match self.route_planner.preview_move_segment(
                connection_id,
                segment_index,
                coordinate,
                snap_grid,
                endpoint_snap_threshold,
            ) {
                Ok(edit) => ResponseBody::RoutePreview(edit),
                Err(error) => routing_error(error),
            },
            Operation::InsertPlannedManualBend {
                connection_id,
                segment_index,
                point,
                snap_grid,
            } => match self.route_planner.preview_insert_manual_bend(
                connection_id,
                segment_index,
                point,
                snap_grid,
            ) {
                Ok(edit) => ResponseBody::RoutePreview(edit),
                Err(error) => routing_error(error),
            },
            Operation::PreviewMoveRouteSegment {
                connection_id,
                segment_index,
                coordinate,
                snap_grid,
                endpoint_snap_threshold,
            } => match self.route(connection_id).and_then(|route| {
                preview_move_segment(
                    route,
                    segment_index,
                    coordinate,
                    snap_grid,
                    endpoint_snap_threshold,
                )
            }) {
                Ok(edit) => ResponseBody::RoutePreview(edit),
                Err(error) => routing_error(error),
            },
            Operation::InsertManualBend {
                connection_id,
                segment_index,
                point,
                snap_grid,
            } => {
                let edit = self.route(connection_id).and_then(|route| {
                    preview_insert_manual_bend(route, segment_index, point, snap_grid)
                });
                self.commit_route_edit(edit)
            }
            Operation::RemoveManualBend {
                connection_id,
                bend_index,
            } => {
                let edit = self
                    .route(connection_id)
                    .and_then(|route| preview_remove_manual_bend(route, bend_index));
                self.commit_route_edit(edit)
            }
            Operation::MoveRouteSegment {
                connection_id,
                segment_index,
                coordinate,
                snap_grid,
                endpoint_snap_threshold,
            } => {
                let edit = self.route(connection_id).and_then(|route| {
                    preview_move_segment(
                        route,
                        segment_index,
                        coordinate,
                        snap_grid,
                        endpoint_snap_threshold,
                    )
                });
                self.commit_route_edit(edit)
            }
            Operation::ResetRoute { connection_id } => {
                let edit = self.route(connection_id).and_then(preview_reset_route);
                self.commit_route_edit(edit)
            }
        };

        EngineResponse {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            base_revision,
            result,
        }
    }

    fn create_connection(
        &mut self,
        mut from: homelab_engine_protocol::EndpointRef,
        mut to: homelab_engine_protocol::EndpointRef,
        created_at: String,
    ) -> ResponseBody {
        let validation = self.topology.validate_connection(&from, &to);
        if !validation.ok {
            return ResponseBody::Error(EngineError {
                code: validation
                    .code
                    .unwrap_or_else(|| "invalid-connection".into()),
                message: validation
                    .message
                    .unwrap_or_else(|| "The connection is invalid.".into()),
            });
        }
        let from_descriptor = self
            .topology
            .endpoint(&from)
            .expect("validated source endpoint must exist");
        let to_descriptor = self
            .topology
            .endpoint(&to)
            .expect("validated destination endpoint must exist");
        let connection_type = if from_descriptor.power.is_some() {
            if from_descriptor
                .power
                .as_ref()
                .is_some_and(|power| power.direction == "input")
            {
                std::mem::swap(&mut from, &mut to);
            }
            "power"
        } else if is_network_port(&from_descriptor.port_type)
            && is_network_port(&to_descriptor.port_type)
        {
            "network"
        } else if is_display_port(&from_descriptor.port_type)
            && is_display_port(&to_descriptor.port_type)
        {
            "display"
        } else {
            "other"
        };
        let Some(connection_id) = self
            .topology
            .snapshot()
            .connections
            .iter()
            .map(|connection| connection.id)
            .max()
            .unwrap_or(0)
            .checked_add(1)
        else {
            return engine_error(
                "connection-id-exhausted",
                "A new connection ID cannot be allocated safely.",
            );
        };
        if created_at.trim().is_empty() {
            return engine_error(
                "invalid-created-at",
                "Connection creation time must not be empty.",
            );
        }
        let connection = TopologyConnection {
            id: connection_id,
            from,
            to,
            connection_type: connection_type.into(),
            negotiated_speed_mbps: None,
            label: None,
            route: None,
            created_at,
        };
        let before = self.topology.snapshot().clone();
        let mut snapshot = before.clone();
        snapshot.connections.push(connection);
        snapshot.connections.sort_by_key(|candidate| candidate.id);
        if let Err(error) = normalize_connection_derived(&mut snapshot) {
            return topology_error(error);
        }
        let connection = snapshot
            .connections
            .iter()
            .find(|candidate| candidate.id == connection_id)
            .expect("normalized connection must exist")
            .clone();
        let (forward_states, inverse_states) = connection_derived_changes(&before, &snapshot);
        let mut forward = vec![ProjectPatch::AddConnection {
            connection: connection.clone(),
        }];
        if !forward_states.is_empty() {
            forward.push(ProjectPatch::SetConnectionDerived {
                states: forward_states,
            });
        }
        let mut inverse = vec![];
        if !inverse_states.is_empty() {
            inverse.push(ProjectPatch::SetConnectionDerived {
                states: inverse_states,
            });
        }
        inverse.push(ProjectPatch::RemoveConnection { connection });
        self.commit_topology(snapshot, batch_patch(forward), batch_patch(inverse))
    }

    fn remove_connection(&mut self, connection_id: u32) -> ResponseBody {
        let Some(connection) = self
            .topology
            .snapshot()
            .connections
            .iter()
            .find(|connection| connection.id == connection_id)
            .cloned()
        else {
            return engine_error(
                "missing-connection",
                "The selected connection no longer exists.",
            );
        };
        let before = self.topology.snapshot().clone();
        let mut snapshot = before.clone();
        snapshot
            .connections
            .retain(|candidate| candidate.id != connection_id);
        if let Err(error) = normalize_connection_derived(&mut snapshot) {
            return topology_error(error);
        }
        let (forward_states, inverse_states) = connection_derived_changes(&before, &snapshot);
        let mut forward = vec![ProjectPatch::RemoveConnection {
            connection: connection.clone(),
        }];
        if !forward_states.is_empty() {
            forward.push(ProjectPatch::SetConnectionDerived {
                states: forward_states,
            });
        }
        let mut inverse = vec![];
        if !inverse_states.is_empty() {
            inverse.push(ProjectPatch::SetConnectionDerived {
                states: inverse_states,
            });
        }
        inverse.push(ProjectPatch::AddConnection { connection });
        self.commit_topology(snapshot, batch_patch(forward), batch_patch(inverse))
    }

    fn update_connection_label(
        &mut self,
        connection_id: u32,
        label: Option<String>,
    ) -> ResponseBody {
        let next_label = label.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        });
        let mut snapshot = self.topology.snapshot().clone();
        let Some(connection) = snapshot
            .connections
            .iter_mut()
            .find(|connection| connection.id == connection_id)
        else {
            return engine_error(
                "missing-connection",
                "The selected connection no longer exists.",
            );
        };
        let previous_label = std::mem::replace(&mut connection.label, next_label.clone());
        self.commit_topology(
            snapshot,
            ProjectPatch::SetConnectionLabel {
                connection_id,
                label: next_label,
            },
            ProjectPatch::SetConnectionLabel {
                connection_id,
                label: previous_label,
            },
        )
    }

    fn update_connection_route(
        &mut self,
        connection_id: u32,
        route: Option<TopologyConnectionRoute>,
    ) -> ResponseBody {
        let mut snapshot = self.topology.snapshot().clone();
        let Some(connection) = snapshot
            .connections
            .iter_mut()
            .find(|connection| connection.id == connection_id)
        else {
            return engine_error(
                "missing-connection",
                "The selected connection no longer exists.",
            );
        };
        let previous_route = std::mem::replace(&mut connection.route, route.clone());
        self.commit_topology(
            snapshot,
            ProjectPatch::SetConnectionRoute {
                connection_id,
                route,
            },
            ProjectPatch::SetConnectionRoute {
                connection_id,
                route: previous_route,
            },
        )
    }

    fn commit_topology(
        &mut self,
        snapshot: TopologySnapshot,
        forward: ProjectPatch,
        inverse: ProjectPatch,
    ) -> ResponseBody {
        if self.revision == u32::MAX {
            return engine_error(
                "revision-exhausted",
                "Project revision cannot be advanced safely.",
            );
        }
        let topology = match TopologyIndex::build(snapshot) {
            Ok(topology) => topology,
            Err(error) => return topology_error(error),
        };
        self.topology = topology;
        self.revision += 1;
        ResponseBody::Patch(Box::new(CommandPatchSet {
            revision: self.revision,
            forward,
            inverse,
        }))
    }

    fn replace_geometry(
        &mut self,
        nodes: Vec<GeometryNode>,
        handles: Vec<GeometryHandle>,
    ) -> ResponseBody {
        let mut replacement = SpatialIndex::default();
        if let Err(error) = replacement.replace(&nodes) {
            return geometry_error(error);
        }
        let replacement_handles = match collect_handles(handles, &replacement) {
            Ok(handles) => handles,
            Err(error) => return geometry_error(error),
        };
        let next_revision = match self.geometry_revision.checked_add(1) {
            Some(revision) => revision,
            None => return geometry_revision_exhausted(),
        };
        self.geometry = replacement;
        self.handles = replacement_handles;
        self.geometry_revision = next_revision;
        ResponseBody::GeometryUpdated(GeometryUpdateResult {
            geometry_revision: self.geometry_revision,
        })
    }

    fn update_geometry(
        &mut self,
        upsert_nodes: Vec<GeometryNode>,
        remove_node_ids: Vec<String>,
        upsert_handles: Vec<GeometryHandle>,
        remove_handle_keys: Vec<String>,
    ) -> ResponseBody {
        let mut geometry = self.geometry.clone();
        let mut handles = self.handles.clone();

        if has_duplicates(upsert_nodes.iter().map(|node| node.item_id.as_str())) {
            return geometry_error(GeometryError::DuplicateIdentifier(
                "upsert geometry node item_id",
            ));
        }
        if has_duplicates(upsert_handles.iter().map(|handle| handle.key.as_str())) {
            return geometry_error(GeometryError::DuplicateIdentifier(
                "upsert geometry handle key",
            ));
        }

        for item_id in remove_node_ids {
            geometry.remove(&item_id);
        }
        for node in upsert_nodes {
            if let Err(error) = geometry.upsert(node) {
                return geometry_error(error);
            }
        }
        for key in remove_handle_keys {
            handles.remove(&key);
        }
        for handle in upsert_handles {
            if let Err(error) = handle.validate() {
                return geometry_error(error);
            }
            handles.insert(handle.key.clone(), handle);
        }
        if let Err(error) = validate_handle_owners(&handles, &geometry) {
            return geometry_error(error);
        }

        let next_revision = match self.geometry_revision.checked_add(1) {
            Some(revision) => revision,
            None => return geometry_revision_exhausted(),
        };
        self.geometry = geometry;
        self.handles = handles;
        self.geometry_revision = next_revision;
        ResponseBody::GeometryUpdated(GeometryUpdateResult {
            geometry_revision: self.geometry_revision,
        })
    }

    fn check_placement(
        &self,
        item_id: String,
        bounds: homelab_engine_protocol::Rect,
        exclude_item_ids: Vec<String>,
    ) -> ResponseBody {
        let candidate = GeometryNode {
            item_id: item_id.clone(),
            bounds,
        };
        if let Err(error) = candidate.validate() {
            return geometry_error(error);
        }
        let mut excluded: BTreeSet<_> = exclude_item_ids.into_iter().collect();
        excluded.insert(item_id);
        let colliding_item_ids = self.geometry.overlapping_ids(bounds, &excluded);
        ResponseBody::PlacementCheck(PlacementCheckResult {
            valid: colliding_item_ids.is_empty(),
            colliding_item_ids,
        })
    }

    fn replace_routes(&mut self, routes: Vec<RouteDefinition>) -> ResponseBody {
        let mut replacement = BTreeMap::new();
        for route in routes {
            if let Err(error) = route.validate() {
                return routing_error(error);
            }
            if replacement.insert(route.connection_id, route).is_some() {
                return routing_error(RoutingError::InvalidConnectionId);
            }
        }
        let next_revision = match self.routing_revision.checked_add(1) {
            Some(revision) => revision,
            None => return routing_revision_exhausted(),
        };
        self.routes = replacement;
        self.routing_revision = next_revision;
        ResponseBody::RoutesUpdated(RoutesUpdateResult {
            routing_revision: self.routing_revision,
        })
    }

    fn route(&self, connection_id: u32) -> Result<&RouteDefinition, RoutingError> {
        self.routes
            .get(&connection_id)
            .ok_or(RoutingError::InvalidConnectionId)
    }

    fn commit_route_edit(&mut self, edit: Result<RouteEdit, RoutingError>) -> ResponseBody {
        let edit = match edit {
            Ok(edit) => edit,
            Err(error) => return routing_error(error),
        };
        let next_revision = match self.routing_revision.checked_add(1) {
            Some(revision) => revision,
            None => return routing_revision_exhausted(),
        };
        let Some(route) = self.routes.get_mut(&edit.forward.connection_id) else {
            return routing_error(RoutingError::InvalidConnectionId);
        };
        route.manual_bends = edit.forward.bend_points.clone();
        self.routing_revision = next_revision;
        ResponseBody::RouteEdited(RouteEditResult {
            routing_revision: self.routing_revision,
            edit,
        })
    }
}

fn collect_handles(
    handles: Vec<GeometryHandle>,
    geometry: &SpatialIndex,
) -> Result<BTreeMap<String, GeometryHandle>, GeometryError> {
    let mut collected = BTreeMap::new();
    for handle in handles {
        handle.validate()?;
        if collected.insert(handle.key.clone(), handle).is_some() {
            return Err(GeometryError::DuplicateIdentifier("geometry handle key"));
        }
    }
    validate_handle_owners(&collected, geometry)?;
    Ok(collected)
}

fn validate_handle_owners(
    handles: &BTreeMap<String, GeometryHandle>,
    geometry: &SpatialIndex,
) -> Result<(), GeometryError> {
    if handles
        .values()
        .any(|handle| geometry.rect(&handle.item_id).is_none())
    {
        return Err(GeometryError::UnknownIdentifier(
            "geometry handle owner node",
        ));
    }
    Ok(())
}

fn has_duplicates<'a>(values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.into_iter().any(|value| !seen.insert(value))
}

fn geometry_error(error: GeometryError) -> ResponseBody {
    ResponseBody::Error(EngineError {
        code: "invalid-geometry".into(),
        message: error.to_string(),
    })
}

fn geometry_revision_exhausted() -> ResponseBody {
    ResponseBody::Error(EngineError {
        code: "geometry-revision-exhausted".into(),
        message: "Geometry revision cannot be advanced safely.".into(),
    })
}

fn routing_error(error: RoutingError) -> ResponseBody {
    ResponseBody::Error(EngineError {
        code: "invalid-route".into(),
        message: error.to_string(),
    })
}

fn routing_revision_exhausted() -> ResponseBody {
    ResponseBody::Error(EngineError {
        code: "routing-revision-exhausted".into(),
        message: "Routing revision cannot be advanced safely.".into(),
    })
}

fn error_response(
    request_id: u32,
    base_revision: u32,
    code: &str,
    message: String,
) -> EngineResponse {
    EngineResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        base_revision,
        result: ResponseBody::Error(EngineError {
            code: code.into(),
            message,
        }),
    }
}

fn engine_error(code: &str, message: &str) -> ResponseBody {
    ResponseBody::Error(EngineError {
        code: code.into(),
        message: message.into(),
    })
}

fn normalize_connection_derived(snapshot: &mut TopologySnapshot) -> Result<(), TopologyError> {
    let index = TopologyIndex::build(snapshot.clone())?;
    let states = index
        .connection_derived_states()
        .into_iter()
        .map(|state| (state.connection_id, state))
        .collect::<BTreeMap<_, _>>();
    for connection in &mut snapshot.connections {
        if let Some(state) = states.get(&connection.id) {
            connection
                .connection_type
                .clone_from(&state.connection_type);
            connection.negotiated_speed_mbps = state.negotiated_speed_mbps;
        }
    }
    Ok(())
}

fn connection_derived_changes(
    before: &TopologySnapshot,
    after: &TopologySnapshot,
) -> (
    Vec<homelab_engine_protocol::ConnectionDerivedState>,
    Vec<homelab_engine_protocol::ConnectionDerivedState>,
) {
    let before = before
        .connections
        .iter()
        .map(|connection| (connection.id, connection))
        .collect::<BTreeMap<_, _>>();
    let mut forward = vec![];
    let mut inverse = vec![];
    for connection in &after.connections {
        let Some(previous) = before.get(&connection.id) else {
            continue;
        };
        if previous.connection_type == connection.connection_type
            && previous.negotiated_speed_mbps == connection.negotiated_speed_mbps
        {
            continue;
        }
        forward.push(homelab_engine_protocol::ConnectionDerivedState {
            connection_id: connection.id,
            connection_type: connection.connection_type.clone(),
            negotiated_speed_mbps: connection.negotiated_speed_mbps,
        });
        inverse.push(homelab_engine_protocol::ConnectionDerivedState {
            connection_id: previous.id,
            connection_type: previous.connection_type.clone(),
            negotiated_speed_mbps: previous.negotiated_speed_mbps,
        });
    }
    (forward, inverse)
}

fn batch_patch(mut patches: Vec<ProjectPatch>) -> ProjectPatch {
    if patches.len() == 1 {
        return patches.pop().expect("single patch must exist");
    }
    ProjectPatch::Batch { patches }
}

fn topology_error(error: TopologyError) -> ResponseBody {
    engine_error("invalid-topology", &error.to_string())
}

fn is_network_port(port_type: &str) -> bool {
    matches!(port_type, "rj45" | "sfp" | "sfp-plus")
}

fn is_display_port(port_type: &str) -> bool {
    matches!(port_type, "hdmi" | "displayport" | "mini-displayport")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::from_snapshot(EngineSnapshot {
            revision: 12,
            project_name: "Homelab Inventory".into(),
            topology: TopologySnapshot {
                items: vec![],
                assignments: vec![],
                connections: vec![],
                placements: vec![],
            },
        })
    }

    fn connection_engine() -> (
        Engine,
        homelab_engine_protocol::EndpointRef,
        homelab_engine_protocol::EndpointRef,
    ) {
        let server = homelab_engine_protocol::ItemRef {
            item_type: "server".into(),
            id: 1,
        };
        let switch = homelab_engine_protocol::ItemRef {
            item_type: "switch".into(),
            id: 1,
        };
        let port = |id| homelab_engine_protocol::TopologyPort {
            id,
            key: None,
            port_type: "rj45".into(),
            slot_number: id,
            speed: Some("2.5G".into()),
            endpoints: vec![],
        };
        let from = homelab_engine_protocol::EndpointRef {
            item: server.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: None,
        };
        let to = homelab_engine_protocol::EndpointRef {
            item: switch.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: None,
        };
        let engine = Engine::from_snapshot(EngineSnapshot {
            revision: 12,
            project_name: "Topology Lab".into(),
            topology: TopologySnapshot {
                items: vec![
                    homelab_engine_protocol::TopologyItem {
                        item: server.clone(),
                        archived: false,
                        power_configuration: None,
                        allow_outlet_fan_out: false,
                        ports: vec![port(1)],
                    },
                    homelab_engine_protocol::TopologyItem {
                        item: switch.clone(),
                        archived: false,
                        power_configuration: None,
                        allow_outlet_fan_out: false,
                        ports: vec![port(1)],
                    },
                ],
                assignments: vec![],
                connections: vec![],
                placements: vec![server, switch],
            },
        });
        (engine, from, to)
    }

    fn passive_path_engine() -> (
        Engine,
        homelab_engine_protocol::EndpointRef,
        homelab_engine_protocol::EndpointRef,
    ) {
        let server = homelab_engine_protocol::ItemRef {
            item_type: "server".into(),
            id: 1,
        };
        let switch = homelab_engine_protocol::ItemRef {
            item_type: "switch".into(),
            id: 1,
        };
        let panel = homelab_engine_protocol::ItemRef {
            item_type: "patchPanel".into(),
            id: 1,
        };
        let endpoint = |item: homelab_engine_protocol::ItemRef, endpoint_id| {
            homelab_engine_protocol::EndpointRef {
                item,
                port_id: 1,
                endpoint_id,
                hosted_item: None,
            }
        };
        let server_endpoint = endpoint(server.clone(), None);
        let panel_front = endpoint(panel.clone(), Some(1));
        let panel_back = endpoint(panel.clone(), Some(2));
        let switch_endpoint = endpoint(switch.clone(), None);
        let item = |item, speed, endpoints| homelab_engine_protocol::TopologyItem {
            item,
            archived: false,
            power_configuration: None,
            allow_outlet_fan_out: false,
            ports: vec![homelab_engine_protocol::TopologyPort {
                id: 1,
                key: None,
                port_type: "rj45".into(),
                slot_number: 1,
                speed,
                endpoints,
            }],
        };
        let engine = Engine::from_snapshot(EngineSnapshot {
            revision: 12,
            project_name: "Passive Path".into(),
            topology: TopologySnapshot {
                items: vec![
                    item(server.clone(), Some("1G".into()), vec![]),
                    item(switch.clone(), Some("2.5G".into()), vec![]),
                    item(
                        panel.clone(),
                        None,
                        vec![
                            homelab_engine_protocol::TopologyPortSide {
                                id: 1,
                                side: "front".into(),
                            },
                            homelab_engine_protocol::TopologyPortSide {
                                id: 2,
                                side: "back".into(),
                            },
                        ],
                    ),
                ],
                assignments: vec![],
                connections: vec![TopologyConnection {
                    id: 1,
                    from: switch_endpoint,
                    to: panel_front,
                    connection_type: "network".into(),
                    negotiated_speed_mbps: Some(2_500),
                    label: None,
                    route: None,
                    created_at: "2026-07-23T00:00:00.000Z".into(),
                }],
                placements: vec![server, switch, panel],
            },
        });
        (engine, server_endpoint, panel_back)
    }

    fn node(item_id: &str, x: f64, y: f64) -> GeometryNode {
        GeometryNode {
            item_id: item_id.into(),
            bounds: homelab_engine_protocol::Rect {
                x,
                y,
                width: 100.0,
                height: 100.0,
            },
        }
    }

    fn lane_route(
        connection_id: u32,
        y: f64,
        avoid_cable_overlap: bool,
    ) -> homelab_engine_protocol::LaneRouteRequest {
        homelab_engine_protocol::LaneRouteRequest {
            avoid_cable_overlap,
            request: homelab_engine_protocol::ObstacleRouteRequest {
                definition: RouteDefinition {
                    connection_id,
                    source: homelab_engine_protocol::Point { x: 0.0, y },
                    target: homelab_engine_protocol::Point { x: 240.0, y },
                    source_side: homelab_engine_protocol::Side::Right,
                    target_side: homelab_engine_protocol::Side::Left,
                    lane_offset: 24.0,
                    manual_bends: vec![],
                },
                source_item_id: "server:1".into(),
                target_item_id: "switch:1".into(),
                obstacles: vec![],
                reserved_segments: vec![],
                snap_to_grid: true,
                grid_size: 12.0,
                previous_valid_route: None,
            },
        }
    }

    fn request(operation: Operation) -> EngineRequest {
        EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 20,
            base_revision: 12,
            operation,
        }
    }

    fn cable_plan(
        requests: Vec<homelab_engine_protocol::LaneRouteRequest>,
    ) -> homelab_engine_protocol::CableRoutePlanRequest {
        homelab_engine_protocol::CableRoutePlanRequest {
            obstacles: vec![],
            requests,
        }
    }

    #[test]
    fn metadata_command_returns_forward_and_inverse_patches() {
        let mut engine = engine();
        let response = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 1,
            base_revision: 12,
            operation: Operation::UpdateProjectMetadata {
                name: " Rack Lab ".into(),
            },
        });

        assert_eq!(engine.project_name(), "Rack Lab");
        assert_eq!(engine.revision(), 13);
        assert_eq!(
            response.result,
            ResponseBody::Patch(Box::new(CommandPatchSet {
                revision: 13,
                forward: ProjectPatch::SetProjectName {
                    name: "Rack Lab".into(),
                },
                inverse: ProjectPatch::SetProjectName {
                    name: "Homelab Inventory".into(),
                },
            }))
        );
    }

    #[test]
    fn connection_commands_return_exact_forward_and_inverse_patches() {
        let (mut engine, from, to) = connection_engine();
        let created = engine.dispatch(request(Operation::CreateConnection {
            from: from.clone(),
            to: to.clone(),
            created_at: "2026-07-23T00:00:00.000Z".into(),
        }));
        let connection = engine.topology().connections[0].clone();
        assert_eq!(connection.id, 1);
        assert_eq!(connection.connection_type, "network");
        assert!(matches!(
            created.result,
            ResponseBody::Patch(ref patch)
                if matches!(&patch.forward, ProjectPatch::AddConnection { connection: added } if added == &connection)
                    && matches!(&patch.inverse, ProjectPatch::RemoveConnection { connection: removed } if removed == &connection)
        ));

        let labeled = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 21,
            base_revision: 13,
            operation: Operation::UpdateConnectionLabel {
                connection_id: 1,
                label: Some("  Uplink  ".into()),
            },
        });
        assert_eq!(
            engine.topology().connections[0].label.as_deref(),
            Some("Uplink")
        );
        assert!(matches!(
            labeled.result,
            ResponseBody::Patch(ref patch)
                if matches!(&patch.inverse, ProjectPatch::SetConnectionLabel { connection_id: 1, label: None })
        ));

        let route = TopologyConnectionRoute {
            source_side: Some("right".into()),
            target_side: Some("left".into()),
            bend_points: vec![homelab_engine_protocol::Point { x: 24.0, y: 48.0 }],
            avoid_cable_overlap: true,
        };
        let routed = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 22,
            base_revision: 14,
            operation: Operation::UpdateConnectionRoute {
                connection_id: 1,
                route: Some(route.clone()),
            },
        });
        assert_eq!(engine.topology().connections[0].route, Some(route));
        assert!(matches!(
            routed.result,
            ResponseBody::Patch(ref patch)
                if matches!(&patch.inverse, ProjectPatch::SetConnectionRoute { connection_id: 1, route: None })
        ));

        let removed_connection = engine.topology().connections[0].clone();
        let removed = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 23,
            base_revision: 15,
            operation: Operation::RemoveConnection { connection_id: 1 },
        });
        assert!(engine.topology().connections.is_empty());
        assert!(matches!(
            removed.result,
            ResponseBody::Patch(ref patch)
                if matches!(&patch.inverse, ProjectPatch::AddConnection { connection: restored } if restored == &removed_connection)
        ));
        assert_eq!(engine.revision(), 16);
    }

    #[test]
    fn invalid_or_stale_connection_commands_are_atomic() {
        let (mut engine, from, _) = connection_engine();
        let invalid = engine.dispatch(request(Operation::CreateConnection {
            from: from.clone(),
            to: from,
            created_at: "2026-07-23T00:00:00.000Z".into(),
        }));
        assert!(matches!(
            invalid.result,
            ResponseBody::Error(EngineError { ref code, .. }) if code == "same-endpoint"
        ));
        assert_eq!(engine.revision(), 12);
        assert!(engine.topology().connections.is_empty());

        let missing = engine.dispatch(request(Operation::RemoveConnection { connection_id: 99 }));
        assert!(matches!(
            missing.result,
            ResponseBody::Error(EngineError { ref code, .. }) if code == "missing-connection"
        ));
        assert_eq!(engine.revision(), 12);
    }

    #[test]
    fn connection_command_batches_passive_path_speed_updates_atomically() {
        let (mut engine, server, panel) = passive_path_engine();
        let response = engine.dispatch(request(Operation::CreateConnection {
            from: server,
            to: panel,
            created_at: "2026-07-23T01:00:00.000Z".into(),
        }));

        assert_eq!(
            engine
                .topology()
                .connections
                .iter()
                .map(|connection| connection.negotiated_speed_mbps)
                .collect::<Vec<_>>(),
            vec![Some(1_000), Some(1_000)]
        );
        assert!(matches!(
            response.result,
            ResponseBody::Patch(ref patch)
                if matches!(&patch.forward,
                    ProjectPatch::Batch { patches }
                    if matches!(&patches[0], ProjectPatch::AddConnection { connection } if connection.negotiated_speed_mbps == Some(1_000))
                        && matches!(&patches[1], ProjectPatch::SetConnectionDerived { states } if states[0].connection_id == 1 && states[0].negotiated_speed_mbps == Some(1_000))
                )
                && matches!(&patch.inverse,
                    ProjectPatch::Batch { patches }
                    if matches!(&patches[0], ProjectPatch::SetConnectionDerived { states } if states[0].negotiated_speed_mbps == Some(2_500))
                )
        ));

        let removed = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 22,
            base_revision: 13,
            operation: Operation::RemoveConnection { connection_id: 2 },
        });
        assert_eq!(
            engine.topology().connections[0].negotiated_speed_mbps,
            Some(2_500)
        );
        assert!(matches!(
            removed.result,
            ResponseBody::Patch(ref patch)
                if matches!(&patch.forward,
                    ProjectPatch::Batch { patches }
                    if matches!(&patches[1], ProjectPatch::SetConnectionDerived { states } if states[0].connection_id == 1 && states[0].negotiated_speed_mbps == Some(2_500))
                )
        ));
    }

    #[test]
    fn stale_revision_is_rejected_without_mutating_state() {
        let mut engine = engine();
        let response = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 2,
            base_revision: 11,
            operation: Operation::UpdateProjectMetadata {
                name: "Wrong".into(),
            },
        });

        assert_eq!(engine.project_name(), "Homelab Inventory");
        assert_eq!(engine.revision(), 12);
        assert!(matches!(
            response.result,
            ResponseBody::Error(EngineError { ref code, .. }) if code == "revision-conflict"
        ));
    }

    #[test]
    fn invalid_name_is_rejected_without_advancing_revision() {
        let mut engine = engine();
        let response = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 3,
            base_revision: 12,
            operation: Operation::UpdateProjectMetadata { name: "  ".into() },
        });

        assert_eq!(engine.revision(), 12);
        assert!(matches!(
            response.result,
            ResponseBody::Error(EngineError { ref code, .. }) if code == "invalid-project-name"
        ));
    }

    #[test]
    fn status_reads_do_not_advance_revision() {
        let mut engine = engine();
        let response = engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 4,
            base_revision: 12,
            operation: Operation::Status,
        });

        assert_eq!(engine.revision(), 12);
        assert_eq!(
            response.result,
            ResponseBody::Status(EngineStatus {
                revision: 12,
                geometry_revision: 0,
                routing_revision: 0,
                project_name: "Homelab Inventory".into(),
            })
        );
    }

    #[test]
    fn geometry_replacement_and_queries_do_not_advance_project_revision() {
        let mut engine = engine();
        let response = engine.dispatch(request(Operation::ReplaceGeometry {
            nodes: vec![node("server:1", 0.0, 0.0), node("server:2", 240.0, 0.0)],
            handles: vec![GeometryHandle {
                key: "server:1:board:1".into(),
                item_id: "server:1".into(),
                point: homelab_engine_protocol::Point { x: 100.0, y: 50.0 },
                side: homelab_engine_protocol::Side::Right,
            }],
        }));

        assert_eq!(engine.revision(), 12);
        assert_eq!(engine.geometry_revision(), 1);
        assert_eq!(
            response.result,
            ResponseBody::GeometryUpdated(GeometryUpdateResult {
                geometry_revision: 1
            })
        );

        let response = engine.dispatch(request(Operation::CheckPlacement {
            item_id: "server:3".into(),
            bounds: homelab_engine_protocol::Rect {
                x: 50.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            exclude_item_ids: vec![],
        }));
        assert_eq!(
            response.result,
            ResponseBody::PlacementCheck(PlacementCheckResult {
                valid: false,
                colliding_item_ids: vec!["server:1".into()],
            })
        );
        assert_eq!(engine.revision(), 12);
        assert_eq!(engine.geometry_revision(), 1);
    }

    #[test]
    fn invalid_incremental_geometry_update_is_atomic() {
        let mut engine = engine();
        engine.dispatch(request(Operation::ReplaceGeometry {
            nodes: vec![node("server:1", 0.0, 0.0)],
            handles: vec![],
        }));

        let response = engine.dispatch(request(Operation::UpdateGeometry {
            upsert_nodes: vec![node("server:2", 240.0, 0.0)],
            remove_node_ids: vec![],
            upsert_handles: vec![GeometryHandle {
                key: "missing:port:1".into(),
                item_id: "missing".into(),
                point: homelab_engine_protocol::Point { x: 0.0, y: 0.0 },
                side: homelab_engine_protocol::Side::Left,
            }],
            remove_handle_keys: vec![],
        }));

        assert!(matches!(
            response.result,
            ResponseBody::Error(EngineError { ref code, .. }) if code == "invalid-geometry"
        ));
        assert_eq!(engine.geometry_revision(), 1);
        let response = engine.dispatch(request(Operation::CheckPlacement {
            item_id: "server:3".into(),
            bounds: homelab_engine_protocol::Rect {
                x: 240.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            exclude_item_ids: vec![],
        }));
        assert!(matches!(
            response.result,
            ResponseBody::PlacementCheck(PlacementCheckResult { valid: true, .. })
        ));
    }

    #[test]
    fn group_and_nearest_placement_queries_are_deterministic() {
        let mut engine = engine();
        engine.dispatch(request(Operation::ReplaceGeometry {
            nodes: vec![node("server:1", 0.0, 0.0), node("server:2", 120.0, 0.0)],
            handles: vec![],
        }));

        let response = engine.dispatch(request(Operation::CheckGroupMove {
            moves: vec![node("server:1", 300.0, 0.0), node("server:2", 350.0, 0.0)],
        }));
        assert_eq!(
            response.result,
            ResponseBody::PlacementCheck(PlacementCheckResult {
                valid: false,
                colliding_item_ids: vec!["server:1".into(), "server:2".into()],
            })
        );

        let response = engine.dispatch(request(Operation::FindNearestPlacement {
            item_id: "server:3".into(),
            preferred: homelab_engine_protocol::Rect {
                x: 0.0,
                y: 0.0,
                width: 50.0,
                height: 50.0,
            },
            clearance: 0.0,
            step: 24.0,
            max_rings: 10,
        }));
        assert_eq!(
            response.result,
            ResponseBody::NearestPlacement(NearestPlacementResult {
                bounds: Some(homelab_engine_protocol::Rect {
                    x: 0.0,
                    y: -72.0,
                    width: 50.0,
                    height: 50.0,
                }),
            })
        );
    }

    #[test]
    fn route_edits_are_revisioned_and_return_inverse_bends() {
        let mut engine = engine();
        let route = RouteDefinition {
            connection_id: 4,
            source: homelab_engine_protocol::Point { x: 100.0, y: 200.0 },
            target: homelab_engine_protocol::Point { x: 460.0, y: 80.0 },
            source_side: homelab_engine_protocol::Side::Right,
            target_side: homelab_engine_protocol::Side::Left,
            lane_offset: 24.0,
            manual_bends: vec![],
        };
        let replaced = engine.dispatch(request(Operation::ReplaceRoutes {
            routes: vec![route],
        }));
        assert_eq!(
            replaced.result,
            ResponseBody::RoutesUpdated(RoutesUpdateResult {
                routing_revision: 1
            })
        );

        let preview = engine.dispatch(request(Operation::PreviewMoveRouteSegment {
            connection_id: 4,
            segment_index: 2,
            coordinate: 131.0,
            snap_grid: None,
            endpoint_snap_threshold: 8.0,
        }));
        assert!(matches!(preview.result, ResponseBody::RoutePreview(_)));
        assert_eq!(engine.routing_revision(), 1);

        let moved = engine.dispatch(request(Operation::MoveRouteSegment {
            connection_id: 4,
            segment_index: 2,
            coordinate: 131.0,
            snap_grid: None,
            endpoint_snap_threshold: 8.0,
        }));
        assert!(matches!(
            moved.result,
            ResponseBody::RouteEdited(RouteEditResult {
                routing_revision: 2,
                ref edit,
            }) if edit.inverse.bend_points.is_empty() && !edit.forward.bend_points.is_empty()
        ));

        let reset = engine.dispatch(request(Operation::ResetRoute { connection_id: 4 }));
        assert!(matches!(
            reset.result,
            ResponseBody::RouteEdited(RouteEditResult {
                routing_revision: 3,
                ref edit,
            }) if edit.forward.bend_points.is_empty() && !edit.inverse.bend_points.is_empty()
        ));
        assert_eq!(engine.revision(), 12);
    }

    #[test]
    fn obstacle_routes_are_read_only_engine_queries() {
        let mut engine = engine();
        let response = engine.dispatch(request(Operation::RouteAroundObstacles {
            request: homelab_engine_protocol::ObstacleRouteRequest {
                definition: RouteDefinition {
                    connection_id: 9,
                    source: homelab_engine_protocol::Point { x: 0.0, y: 72.0 },
                    target: homelab_engine_protocol::Point { x: 300.0, y: 72.0 },
                    source_side: homelab_engine_protocol::Side::Right,
                    target_side: homelab_engine_protocol::Side::Left,
                    lane_offset: 24.0,
                    manual_bends: vec![],
                },
                source_item_id: "server:1".into(),
                target_item_id: "patchPanel:1".into(),
                obstacles: vec![homelab_engine_protocol::RouteObstacle {
                    item_id: "switch:1".into(),
                    bounds: homelab_engine_protocol::Rect {
                        x: 84.0,
                        y: 12.0,
                        width: 132.0,
                        height: 120.0,
                    },
                }],
                reserved_segments: vec![],
                snap_to_grid: true,
                grid_size: 12.0,
                previous_valid_route: None,
            },
        }));

        assert!(matches!(
            response.result,
            ResponseBody::ObstacleRoute(ref result)
                if !result.used_fallback && result.warning.is_none()
        ));
        assert_eq!(engine.revision(), 12);
        assert_eq!(engine.routing_revision(), 0);
    }

    #[test]
    fn cable_plan_cache_reports_targeted_recalculation() {
        let mut engine = engine();
        let requests = vec![lane_route(1, 24.0, false), lane_route(2, 24.0, true)];
        let initial = engine.dispatch(request(Operation::PlanCableRoutes {
            plan: cable_plan(requests.clone()),
        }));
        assert!(matches!(
            initial.result,
            ResponseBody::CableRoutesPlanned(ref plan)
                if plan.recalculated_connection_ids == vec![1, 2]
        ));

        let unchanged = engine.dispatch(request(Operation::PlanCableRoutes {
            plan: cable_plan(requests.clone()),
        }));
        assert!(matches!(
            unchanged.result,
            ResponseBody::CableRoutesPlanned(ref plan)
                if plan.recalculated_connection_ids.is_empty()
        ));

        let changed = engine.dispatch(request(Operation::PlanCableRoutes {
            plan: cable_plan(vec![lane_route(1, 36.0, false), requests[1].clone()]),
        }));
        assert!(matches!(
            changed.result,
            ResponseBody::CableRoutesPlanned(ref plan)
                if plan.recalculated_connection_ids == vec![1, 2]
        ));
        assert_eq!(engine.revision(), 12);
        assert_eq!(engine.routing_revision(), 0);
    }
}
