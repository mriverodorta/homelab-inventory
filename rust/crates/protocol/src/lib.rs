use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineSnapshot {
    pub revision: u32,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineRequest {
    pub protocol_version: u16,
    pub request_id: u32,
    pub base_revision: u32,
    pub operation: Operation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "kebab-case")]
pub enum Operation {
    Status,
    UpdateProjectMetadata { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineResponse {
    pub protocol_version: u16,
    pub request_id: u32,
    pub base_revision: u32,
    pub result: ResponseBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "kebab-case")]
pub enum ResponseBody {
    Status(EngineStatus),
    Patch(CommandPatchSet),
    Error(EngineError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineStatus {
    pub revision: u32,
    pub project_name: String,
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
}
