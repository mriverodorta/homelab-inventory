use std::collections::{BTreeMap, BTreeSet};

use homelab_engine_protocol::{
    CommandPatchSet, EngineError, EngineRequest, EngineResponse, EngineSnapshot, EngineStatus,
    GeometryHandle, GeometryUpdateResult, NearestPlacementResult, Operation, PROTOCOL_VERSION,
    PlacementCheckResult, ProjectPatch, ResponseBody,
};
use homelab_geometry::{GeometryError, GeometryNode, SpatialIndex};

#[derive(Debug, Clone)]
pub struct Engine {
    revision: u32,
    project_name: String,
    geometry_revision: u32,
    geometry: SpatialIndex,
    handles: BTreeMap<String, GeometryHandle>,
}

impl Engine {
    #[must_use]
    pub fn from_snapshot(snapshot: EngineSnapshot) -> Self {
        Self {
            revision: snapshot.revision,
            project_name: snapshot.project_name,
            geometry_revision: 0,
            geometry: SpatialIndex::default(),
            handles: BTreeMap::new(),
        }
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
                project_name: self.project_name.clone(),
            }),
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
                    ResponseBody::Patch(CommandPatchSet {
                        revision: self.revision,
                        forward: ProjectPatch::SetProjectName {
                            name: self.project_name.clone(),
                        },
                        inverse: ProjectPatch::SetProjectName {
                            name: previous_name,
                        },
                    })
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
        };

        EngineResponse {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            base_revision,
            result,
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::from_snapshot(EngineSnapshot {
            revision: 12,
            project_name: "Homelab Inventory".into(),
        })
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

    fn request(operation: Operation) -> EngineRequest {
        EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 20,
            base_revision: 12,
            operation,
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
            ResponseBody::Patch(CommandPatchSet {
                revision: 13,
                forward: ProjectPatch::SetProjectName {
                    name: "Rack Lab".into(),
                },
                inverse: ProjectPatch::SetProjectName {
                    name: "Homelab Inventory".into(),
                },
            })
        );
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
}
