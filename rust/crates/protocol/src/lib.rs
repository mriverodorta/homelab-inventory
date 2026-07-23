use serde::{Deserialize, Serialize};

pub use homelab_geometry::{
    ArrangementItem, GeometryHandle, GeometryNode, Point, Rect, Segment, Side,
};

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineSnapshot {
    pub revision: u32,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineRequest {
    pub protocol_version: u16,
    pub request_id: u32,
    pub base_revision: u32,
    pub operation: Operation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "kebab-case")]
pub enum Operation {
    Status,
    UpdateProjectMetadata {
        name: String,
    },
    ReplaceGeometry {
        nodes: Vec<GeometryNode>,
        handles: Vec<GeometryHandle>,
    },
    UpdateGeometry {
        upsert_nodes: Vec<GeometryNode>,
        remove_node_ids: Vec<String>,
        upsert_handles: Vec<GeometryHandle>,
        remove_handle_keys: Vec<String>,
    },
    CheckPlacement {
        item_id: String,
        bounds: Rect,
        exclude_item_ids: Vec<String>,
    },
    CheckGroupMove {
        moves: Vec<GeometryNode>,
    },
    FindNearestPlacement {
        item_id: String,
        preferred: Rect,
        clearance: f64,
        step: f64,
        max_rings: u16,
    },
    ArrangeItems {
        items: Vec<ArrangementItem>,
        grid_size: f64,
        column_gap: f64,
        item_gap: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineResponse {
    pub protocol_version: u16,
    pub request_id: u32,
    pub base_revision: u32,
    pub result: ResponseBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "kebab-case")]
pub enum ResponseBody {
    Status(EngineStatus),
    Patch(CommandPatchSet),
    GeometryUpdated(GeometryUpdateResult),
    PlacementCheck(PlacementCheckResult),
    NearestPlacement(NearestPlacementResult),
    Arrangement(ArrangementResult),
    Error(EngineError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineStatus {
    pub revision: u32,
    pub geometry_revision: u32,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeometryUpdateResult {
    pub geometry_revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlacementCheckResult {
    pub valid: bool,
    pub colliding_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NearestPlacementResult {
    pub bounds: Option<Rect>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementResult {
    pub nodes: Vec<GeometryNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandPatchSet {
    pub revision: u32,
    pub forward: ProjectPatch,
    pub inverse: ProjectPatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "kebab-case")]
pub enum ProjectPatch {
    SetProjectName { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineError {
    pub code: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_metadata_request_round_trips() {
        let request = EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 7,
            base_revision: 12,
            operation: Operation::UpdateProjectMetadata {
                name: "Rack Lab".into(),
            },
        };

        let bytes = rmp_serde::to_vec_named(&request).expect("serialize request");
        let decoded: EngineRequest = rmp_serde::from_slice(&bytes).expect("deserialize request");
        assert_eq!(decoded, request);
    }

    #[test]
    fn snapshot_round_trips() {
        let snapshot = EngineSnapshot {
            revision: 3,
            project_name: "Homelab Inventory".into(),
        };

        let bytes = rmp_serde::to_vec_named(&snapshot).expect("serialize snapshot");
        let decoded: EngineSnapshot = rmp_serde::from_slice(&bytes).expect("deserialize snapshot");
        assert_eq!(decoded, snapshot);
    }

    #[test]
    fn unicode_strings_round_trip() {
        let snapshot = EngineSnapshot {
            revision: 3,
            project_name: "Laboratorio São José 日本".into(),
        };

        let bytes = rmp_serde::to_vec_named(&snapshot).expect("serialize Unicode snapshot");
        let decoded: EngineSnapshot =
            rmp_serde::from_slice(&bytes).expect("deserialize Unicode snapshot");
        assert_eq!(decoded, snapshot);
    }

    #[test]
    fn geometry_records_round_trip_with_fractional_coordinates() {
        let node = GeometryNode {
            item_id: "server:1".into(),
            bounds: Rect {
                x: 12.5,
                y: 24.25,
                width: 282.0,
                height: 240.0,
            },
        };
        let bytes = rmp_serde::to_vec_named(&node).expect("serialize geometry node");
        let decoded: GeometryNode =
            rmp_serde::from_slice(&bytes).expect("deserialize geometry node");
        assert_eq!(decoded, node);
        decoded.validate().expect("valid geometry node");
    }

    #[test]
    fn geometry_operations_round_trip() {
        let request = EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: 9,
            base_revision: 3,
            operation: Operation::FindNearestPlacement {
                item_id: "server:7".into(),
                preferred: Rect {
                    x: 12.5,
                    y: -4.25,
                    width: 282.0,
                    height: 240.0,
                },
                clearance: 12.0,
                step: 24.0,
                max_rings: 64,
            },
        };

        let bytes = rmp_serde::to_vec_named(&request).expect("serialize geometry request");
        let decoded: EngineRequest =
            rmp_serde::from_slice(&bytes).expect("deserialize geometry request");
        assert_eq!(decoded, request);
    }
}
