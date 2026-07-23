use std::{hint::black_box, time::Instant};

use homelab_domain_core::Engine;
use homelab_engine_protocol::{EngineRequest, EngineSnapshot, Operation, PROTOCOL_VERSION};

const ITERATIONS: u32 = 10_000;

fn main() {
    let started = Instant::now();
    let mut engine = Engine::from_snapshot(EngineSnapshot {
        revision: 1,
        project_name: "Benchmark".into(),
        topology: homelab_engine_protocol::TopologySnapshot {
            items: vec![],
            assignments: vec![],
            connections: vec![],
            placements: vec![],
        },
    });

    let status_started = Instant::now();
    for request_id in 1..=ITERATIONS {
        black_box(engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            base_revision: engine.revision(),
            operation: Operation::Status,
        }));
    }
    let status_elapsed = status_started.elapsed();

    let patch_started = Instant::now();
    for request_id in 1..=ITERATIONS {
        black_box(engine.dispatch(EngineRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            base_revision: engine.revision(),
            operation: Operation::UpdateProjectMetadata {
                name: format!("Benchmark {}", request_id % 2),
            },
        }));
    }

    println!(
        "phase1 status_10k_ms={} patch_10k_ms={} total_ms={}",
        status_elapsed.as_secs_f64() * 1_000.0,
        patch_started.elapsed().as_secs_f64() * 1_000.0,
        started.elapsed().as_secs_f64() * 1_000.0,
    );
}
