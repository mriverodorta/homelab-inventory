use homelab_engine_protocol::{
    CommandPatchSet, EngineError, EngineRequest, EngineResponse, EngineSnapshot, EngineStatus,
    Operation, PROTOCOL_VERSION, ProjectPatch, ResponseBody,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Engine {
    revision: u32,
    project_name: String,
}

impl Engine {
    #[must_use]
    pub fn from_snapshot(snapshot: EngineSnapshot) -> Self {
        Self {
            revision: snapshot.revision,
            project_name: snapshot.project_name,
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
        };

        EngineResponse {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            base_revision,
            result,
        }
    }
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
                project_name: "Homelab Inventory".into(),
            })
        );
    }
}
