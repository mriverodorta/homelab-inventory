use postcard_bindgen::PostcardBindings;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub struct EngineSnapshot {
    pub revision: u32,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub struct EngineRequest {
    pub protocol_version: u16,
    pub request_id: u32,
    pub base_revision: u32,
    pub operation: Operation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub enum Operation {
    Status,
    UpdateProjectMetadata { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub struct EngineResponse {
    pub protocol_version: u16,
    pub request_id: u32,
    pub base_revision: u32,
    pub result: ResponseBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub enum ResponseBody {
    Status(EngineStatus),
    Patch(CommandPatchSet),
    Error(EngineError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub struct EngineStatus {
    pub revision: u32,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub struct CommandPatchSet {
    pub revision: u32,
    pub forward: ProjectPatch,
    pub inverse: ProjectPatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
pub enum ProjectPatch {
    SetProjectName { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PostcardBindings)]
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

        let bytes = postcard::to_allocvec(&request).expect("serialize request");
        let decoded: EngineRequest = postcard::from_bytes(&bytes).expect("deserialize request");
        assert_eq!(decoded, request);
    }

    #[test]
    fn snapshot_round_trips() {
        let snapshot = EngineSnapshot {
            revision: 3,
            project_name: "Homelab Inventory".into(),
        };

        let bytes = postcard::to_allocvec(&snapshot).expect("serialize snapshot");
        let decoded: EngineSnapshot = postcard::from_bytes(&bytes).expect("deserialize snapshot");
        assert_eq!(decoded, snapshot);
    }
}
