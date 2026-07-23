use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use homelab_geometry::Point;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopologyError {
    EmptyType,
    InvalidId,
    DuplicateItem,
    DuplicatePort,
    DuplicatePortEndpoint,
    DuplicateAssignment,
    DuplicateConnection,
    MissingItem,
    InvalidHostedItem,
    InvalidPort,
    InvalidPortEndpoint,
    InvalidRoute,
    UnavailableEndpoint,
}

impl fmt::Display for TopologyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::EmptyType => "Topology type values must not be empty.",
            Self::InvalidId => "Topology IDs must be positive integers.",
            Self::DuplicateItem => "Topology item references must be unique.",
            Self::DuplicatePort => "Port IDs must be unique within an inventory item.",
            Self::DuplicatePortEndpoint => "Port endpoint IDs must be unique within a port.",
            Self::DuplicateAssignment => "Topology assignment IDs must be unique.",
            Self::DuplicateConnection => "Topology connection IDs must be unique.",
            Self::MissingItem => "Topology relationship references a missing item.",
            Self::InvalidHostedItem => "Hosted endpoint does not match an assignment to its host.",
            Self::InvalidPort => "Topology endpoint references a missing port.",
            Self::InvalidPortEndpoint => "Topology endpoint references an invalid port side.",
            Self::InvalidRoute => "Connection route contains an invalid coordinate.",
            Self::UnavailableEndpoint => {
                "Topology endpoint is not exposed by a direct host or assigned component."
            }
        })
    }
}

impl std::error::Error for TopologyError {}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ItemRef {
    pub item_type: String,
    pub id: u32,
}

impl ItemRef {
    pub fn validate(&self) -> Result<(), TopologyError> {
        if self.item_type.trim().is_empty() {
            return Err(TopologyError::EmptyType);
        }
        if self.id == 0 {
            return Err(TopologyError::InvalidId);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EndpointRef {
    pub item: ItemRef,
    pub port_id: u32,
    pub endpoint_id: Option<u32>,
    pub hosted_item: Option<ItemRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyPortSide {
    pub id: u32,
    pub side: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyPort {
    pub id: u32,
    pub key: Option<String>,
    pub port_type: String,
    pub slot_number: u32,
    pub speed: Option<String>,
    pub endpoints: Vec<TopologyPortSide>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyItem {
    pub item: ItemRef,
    pub archived: bool,
    pub power_configuration: Option<String>,
    pub allow_outlet_fan_out: bool,
    pub ports: Vec<TopologyPort>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyAssignment {
    pub id: u32,
    pub host: ItemRef,
    pub item: ItemRef,
    pub component_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectionRoute {
    pub source_side: Option<String>,
    pub target_side: Option<String>,
    pub bend_points: Vec<Point>,
    pub avoid_cable_overlap: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopologyConnection {
    pub id: u32,
    pub from: EndpointRef,
    pub to: EndpointRef,
    pub connection_type: String,
    pub negotiated_speed_mbps: Option<u32>,
    pub label: Option<String>,
    pub route: Option<ConnectionRoute>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopologySnapshot {
    pub items: Vec<TopologyItem>,
    pub assignments: Vec<TopologyAssignment>,
    pub connections: Vec<TopologyConnection>,
    pub placements: Vec<ItemRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointDescriptor {
    pub endpoint: EndpointRef,
    pub host: ItemRef,
    pub owner: ItemRef,
    pub port_type: String,
    pub slot_number: u32,
    pub side: Option<String>,
    pub speed: Option<String>,
    pub connection_ids: Vec<u32>,
    pub placed: bool,
    pub available: bool,
    pub power: Option<PowerEndpointDescriptor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PowerEndpointDescriptor {
    pub direction: String,
    pub kind: String,
    pub allow_fan_out: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionValidation {
    pub ok: bool,
    pub code: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionDerivedState {
    pub connection_id: u32,
    pub connection_type: String,
    pub negotiated_speed_mbps: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NetworkTraceStep {
    pub endpoint: EndpointRef,
    pub state: String,
    pub connection_id: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NetworkTrace {
    pub start: EndpointRef,
    pub steps: Vec<NetworkTraceStep>,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PowerTopologyFinding {
    pub id: String,
    pub code: String,
    pub severity: String,
    pub item: Option<ItemRef>,
    pub connection_id: Option<u32>,
    pub endpoint: Option<EndpointRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PowerTopology {
    pub endpoints: Vec<EndpointDescriptor>,
    pub findings: Vec<PowerTopologyFinding>,
}

#[derive(Debug, Clone)]
pub struct TopologyIndex {
    snapshot: TopologySnapshot,
    endpoints: BTreeMap<EndpointRef, EndpointDescriptor>,
    assignments_by_host: BTreeMap<ItemRef, Vec<TopologyAssignment>>,
    host_by_assigned_item: BTreeMap<ItemRef, ItemRef>,
    placements: BTreeSet<ItemRef>,
}

impl TopologyIndex {
    pub fn build(snapshot: TopologySnapshot) -> Result<Self, TopologyError> {
        snapshot.validate()?;
        let items = snapshot
            .items
            .iter()
            .map(|item| (item.item.clone(), item))
            .collect::<BTreeMap<_, _>>();
        let mut assignments_by_host = BTreeMap::<ItemRef, Vec<TopologyAssignment>>::new();
        let mut host_by_assigned_item = BTreeMap::new();
        for assignment in &snapshot.assignments {
            assignments_by_host
                .entry(assignment.host.clone())
                .or_default()
                .push(assignment.clone());
            host_by_assigned_item.insert(assignment.item.clone(), assignment.host.clone());
        }
        for assignments in assignments_by_host.values_mut() {
            assignments.sort_by_key(|assignment| assignment.id);
        }

        let placements = snapshot.placements.iter().cloned().collect::<BTreeSet<_>>();
        let mut endpoints = BTreeMap::new();
        for item in &snapshot.items {
            if !item.archived && exposes_direct_ports(&item.item.item_type) {
                index_item_ports(&mut endpoints, item, item, placements.contains(&item.item));
            }
        }
        for assignment in &snapshot.assignments {
            let Some(host) = items.get(&assignment.host) else {
                return Err(TopologyError::MissingItem);
            };
            let Some(owner) = items.get(&assignment.item) else {
                return Err(TopologyError::MissingItem);
            };
            if host.archived || owner.archived || !hosts_components(&host.item.item_type) {
                continue;
            }
            index_item_ports(&mut endpoints, host, owner, placements.contains(&host.item));
        }

        for connection in &snapshot.connections {
            for endpoint in [&connection.from, &connection.to] {
                if let Some(descriptor) = endpoints.get_mut(endpoint) {
                    descriptor.connection_ids.push(connection.id);
                } else if endpoint.hosted_item.is_none()
                    && !exposes_direct_ports(&endpoint.item.item_type)
                {
                    return Err(TopologyError::UnavailableEndpoint);
                }
            }
        }
        for descriptor in endpoints.values_mut() {
            descriptor.connection_ids.sort_unstable();
            descriptor.available = descriptor.connection_ids.is_empty()
                || descriptor
                    .power
                    .as_ref()
                    .is_some_and(|power| power.allow_fan_out);
        }

        Ok(Self {
            snapshot,
            endpoints,
            assignments_by_host,
            host_by_assigned_item,
            placements,
        })
    }

    #[must_use]
    pub const fn snapshot(&self) -> &TopologySnapshot {
        &self.snapshot
    }

    #[must_use]
    pub fn endpoints(&self) -> Vec<EndpointDescriptor> {
        self.endpoints.values().cloned().collect()
    }

    #[must_use]
    pub fn endpoint(&self, endpoint: &EndpointRef) -> Option<&EndpointDescriptor> {
        self.endpoints.get(endpoint)
    }

    #[must_use]
    pub fn assignments_for_host(&self, host: &ItemRef) -> &[TopologyAssignment] {
        self.assignments_by_host
            .get(host)
            .map_or(&[], Vec::as_slice)
    }

    #[must_use]
    pub fn host_for_assigned_item(&self, item: &ItemRef) -> Option<&ItemRef> {
        self.host_by_assigned_item.get(item)
    }

    #[must_use]
    pub fn is_placed(&self, item: &ItemRef) -> bool {
        self.placements.contains(item)
    }

    #[must_use]
    pub fn compatible_destinations(&self, source: &EndpointRef) -> Vec<EndpointDescriptor> {
        let Some(source_descriptor) = self.endpoint(source) else {
            return vec![];
        };
        self.endpoints
            .values()
            .filter(|target| {
                target.placed
                    && target.host != source_descriptor.host
                    && self.validate_connection(source, &target.endpoint).ok
            })
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn validate_connection(
        &self,
        first: &EndpointRef,
        second: &EndpointRef,
    ) -> ConnectionValidation {
        if first == second {
            return invalid("same-endpoint", "Choose two different ports to connect.");
        }
        let Some(first_descriptor) = self.endpoint(first) else {
            return invalid(
                "stale-endpoint",
                "One of the selected ports is no longer available.",
            );
        };
        let Some(second_descriptor) = self.endpoint(second) else {
            return invalid(
                "stale-endpoint",
                "One of the selected ports is no longer available.",
            );
        };
        if first_descriptor.host == second_descriptor.host {
            return invalid("same-host", "Choose a port on different equipment.");
        }
        match (&first_descriptor.power, &second_descriptor.power) {
            (Some(first_power), Some(second_power)) => {
                if first_power.direction == second_power.direction {
                    return invalid(
                        "invalid-power-direction",
                        "Power connections must run from an outlet to an AC input.",
                    );
                }
            }
            (Some(_), None) | (None, Some(_)) => {
                return invalid(
                    "incompatible-port-type",
                    "Power endpoints can only connect to other power endpoints.",
                );
            }
            (None, None) => {
                if !ports_compatible(&first_descriptor.port_type, &second_descriptor.port_type) {
                    return invalid(
                        "incompatible-port-type",
                        "Those port types cannot be connected.",
                    );
                }
            }
        }
        if !first_descriptor.available {
            return invalid("source-occupied", "The source port is already connected.");
        }
        if !second_descriptor.available {
            return invalid(
                "destination-occupied",
                "The destination port is already connected.",
            );
        }
        ConnectionValidation {
            ok: true,
            code: None,
            message: None,
        }
    }

    #[must_use]
    pub fn connection_derived_states(&self) -> Vec<ConnectionDerivedState> {
        let mut adjacency = BTreeMap::<EndpointRef, BTreeSet<EndpointRef>>::new();
        let mut network_connections = BTreeMap::<u32, (&EndpointRef, &EndpointRef)>::new();

        for connection in &self.snapshot.connections {
            let connection_type = self.classify_connection(&connection.from, &connection.to);
            if connection_type == "network" {
                add_graph_edge(&mut adjacency, &connection.from, &connection.to);
                network_connections.insert(connection.id, (&connection.from, &connection.to));
            }
        }
        for item in &self.snapshot.items {
            if item.archived || item.item.item_type != "patchPanel" {
                continue;
            }
            for port in &item.ports {
                if !is_network_port(&port.port_type) {
                    continue;
                }
                let front = port
                    .endpoints
                    .iter()
                    .find(|endpoint| endpoint.side == "front");
                let back = port
                    .endpoints
                    .iter()
                    .find(|endpoint| endpoint.side == "back");
                if let (Some(front), Some(back)) = (front, back) {
                    add_graph_edge(
                        &mut adjacency,
                        &EndpointRef {
                            item: item.item.clone(),
                            port_id: port.id,
                            endpoint_id: Some(front.id),
                            hosted_item: None,
                        },
                        &EndpointRef {
                            item: item.item.clone(),
                            port_id: port.id,
                            endpoint_id: Some(back.id),
                            hosted_item: None,
                        },
                    );
                }
            }
        }

        let mut speed_by_endpoint = BTreeMap::<EndpointRef, Option<u32>>::new();
        let mut visited = BTreeSet::new();
        for start in adjacency.keys() {
            if !visited.insert(start.clone()) {
                continue;
            }
            let mut component = vec![];
            let mut speeds = vec![];
            let mut pending = vec![start.clone()];
            while let Some(current) = pending.pop() {
                component.push(current.clone());
                if let Some(speed) = self.endpoint_advertised_speed(&current) {
                    speeds.push(speed);
                }
                for neighbor in adjacency.get(&current).into_iter().flatten() {
                    if visited.insert(neighbor.clone()) {
                        pending.push(neighbor.clone());
                    }
                }
            }
            let negotiated = speeds.into_iter().min();
            for endpoint in component {
                speed_by_endpoint.insert(endpoint, negotiated);
            }
        }

        self.snapshot
            .connections
            .iter()
            .map(|connection| {
                let connection_type = self.classify_connection(&connection.from, &connection.to);
                let negotiated_speed_mbps = (connection_type == "network")
                    .then(|| speed_by_endpoint.get(&connection.from).copied().flatten())
                    .flatten();
                ConnectionDerivedState {
                    connection_id: connection.id,
                    connection_type,
                    negotiated_speed_mbps,
                }
            })
            .collect()
    }

    #[must_use]
    pub fn trace_network_path(&self, start: &EndpointRef) -> Option<NetworkTrace> {
        let start_descriptor = self.endpoint(start)?;
        if !is_network_port(&start_descriptor.port_type) {
            return None;
        }
        let start_connection = self.network_connection_for_endpoint(start);
        let mut steps = vec![NetworkTraceStep {
            endpoint: start.clone(),
            state: if start_connection.is_some() {
                "connected"
            } else {
                "open"
            }
            .into(),
            connection_id: None,
        }];
        if start_connection.is_none() {
            return Some(NetworkTrace {
                start: start.clone(),
                steps,
                complete: false,
            });
        }

        let mut visited = BTreeSet::from([start.clone()]);
        let mut current = start.clone();
        let mut complete = false;
        while visited.len() <= self.endpoints.len() {
            let Some(connection) = self.network_connection_for_endpoint(&current) else {
                steps.push(NetworkTraceStep {
                    endpoint: current,
                    state: "open".into(),
                    connection_id: None,
                });
                break;
            };
            let next = if connection.from == current {
                connection.to.clone()
            } else {
                connection.from.clone()
            };
            if !visited.insert(next.clone()) {
                break;
            }
            steps.push(NetworkTraceStep {
                endpoint: next.clone(),
                state: "connected".into(),
                connection_id: Some(connection.id),
            });
            if next.item.item_type == "switch" {
                complete = true;
                break;
            }
            let Some(peer) = self.patch_panel_peer(&next) else {
                current = next;
                continue;
            };
            if !visited.insert(peer.clone()) {
                break;
            }
            steps.push(NetworkTraceStep {
                endpoint: peer.clone(),
                state: "internal".into(),
                connection_id: None,
            });
            current = peer;
        }
        Some(NetworkTrace {
            start: start.clone(),
            steps,
            complete,
        })
    }

    #[must_use]
    pub fn power_topology(&self) -> PowerTopology {
        PowerTopology {
            endpoints: self
                .endpoints
                .values()
                .filter(|endpoint| endpoint.power.is_some())
                .cloned()
                .collect(),
            findings: self.power_findings(),
        }
    }

    fn power_findings(&self) -> Vec<PowerTopologyFinding> {
        let mut findings = Vec::new();
        let mut input_connections = BTreeMap::<EndpointRef, Vec<&TopologyConnection>>::new();
        let mut output_connections = BTreeMap::<EndpointRef, Vec<&TopologyConnection>>::new();

        for connection in &self.snapshot.connections {
            let from = self
                .endpoint(&connection.from)
                .and_then(|endpoint| endpoint.power.as_ref());
            let to = self
                .endpoint(&connection.to)
                .and_then(|endpoint| endpoint.power.as_ref());

            if connection.connection_type != "power" {
                if from.is_some() || to.is_some() {
                    findings.push(power_connection_finding(
                        "power.connection.misclassified",
                        connection,
                        None,
                    ));
                }
                continue;
            }

            let (Some(from_power), Some(to_power)) = (from, to) else {
                findings.push(power_connection_finding(
                    "power.connection.stale-endpoint",
                    connection,
                    Some(if from.is_none() {
                        connection.from.clone()
                    } else {
                        connection.to.clone()
                    }),
                ));
                continue;
            };

            if from_power.direction != "output"
                || to_power.direction != "input"
                || connection.from.item == connection.to.item
            {
                findings.push(power_connection_finding(
                    "power.connection.invalid-direction",
                    connection,
                    None,
                ));
                continue;
            }

            input_connections
                .entry(connection.to.clone())
                .or_default()
                .push(connection);
            output_connections
                .entry(connection.from.clone())
                .or_default()
                .push(connection);
        }

        for connections in input_connections.values() {
            for connection in connections.iter().skip(1) {
                findings.push(power_connection_finding(
                    "power.connection.duplicate-input",
                    connection,
                    Some(connection.to.clone()),
                ));
            }
        }
        for (endpoint, connections) in output_connections {
            let allows_fan_out = self
                .endpoint(&endpoint)
                .and_then(|descriptor| descriptor.power.as_ref())
                .is_some_and(|power| power.allow_fan_out);
            if allows_fan_out {
                continue;
            }
            for connection in connections.iter().skip(1) {
                findings.push(power_connection_finding(
                    "power.connection.output-fan-out",
                    connection,
                    Some(connection.from.clone()),
                ));
            }
        }

        for item in &self.placements {
            let item_type = item.item_type.as_str();
            if item_type == "monitor" {
                if let Some(input) = self.power_input_for_host(item)
                    && !self.power_input_is_connected(&input)
                {
                    findings.push(power_item_finding(
                        "power.monitor.unpowered",
                        item,
                        Some(input),
                    ));
                }
                continue;
            }
            if !matches!(item_type, "server" | "nas" | "pcBuild") {
                continue;
            }
            let Some(input) = self.power_input_for_host(item) else {
                findings.push(power_item_finding("power.host.missing-input", item, None));
                continue;
            };
            if !self.power_input_is_connected(&input) {
                findings.push(power_item_finding(
                    "power.host.unpowered",
                    item,
                    Some(input),
                ));
            }
        }

        findings
    }

    fn power_input_for_host(&self, host: &ItemRef) -> Option<EndpointRef> {
        self.endpoints
            .values()
            .find(|descriptor| {
                descriptor.host == *host
                    && descriptor
                        .power
                        .as_ref()
                        .is_some_and(|power| power.direction == "input")
            })
            .map(|descriptor| descriptor.endpoint.clone())
    }

    fn power_input_is_connected(&self, input: &EndpointRef) -> bool {
        self.snapshot.connections.iter().any(|connection| {
            connection.connection_type == "power"
                && connection.to == *input
                && self
                    .endpoint(&connection.from)
                    .and_then(|descriptor| descriptor.power.as_ref())
                    .is_some_and(|power| power.direction == "output")
        })
    }

    fn classify_connection(&self, from: &EndpointRef, to: &EndpointRef) -> String {
        let Some(from_descriptor) = self.endpoint(from) else {
            return "other".into();
        };
        let Some(to_descriptor) = self.endpoint(to) else {
            return "other".into();
        };
        if from_descriptor.power.is_some() && to_descriptor.power.is_some() {
            "power"
        } else if from_descriptor.port_type == to_descriptor.port_type
            && is_network_port(&from_descriptor.port_type)
        {
            "network"
        } else if is_display_port(&from_descriptor.port_type)
            && is_display_port(&to_descriptor.port_type)
        {
            "display"
        } else {
            "other"
        }
        .into()
    }

    fn endpoint_advertised_speed(&self, endpoint: &EndpointRef) -> Option<u32> {
        let descriptor = self.endpoint(endpoint)?;
        if !matches!(
            descriptor.host.item_type.as_str(),
            "server" | "nas" | "pcBuild" | "switch"
        ) || !is_network_port(&descriptor.port_type)
        {
            return None;
        }
        parse_advertised_speed(descriptor.speed.as_deref()).or_else(|| {
            (descriptor.port_type == "sfp-plus" && descriptor.speed.is_none()).then_some(10_000)
        })
    }

    fn network_connection_for_endpoint(
        &self,
        endpoint: &EndpointRef,
    ) -> Option<&TopologyConnection> {
        let descriptor = self.endpoint(endpoint)?;
        descriptor.connection_ids.iter().find_map(|connection_id| {
            let connection = self
                .snapshot
                .connections
                .iter()
                .find(|connection| connection.id == *connection_id)?;
            (self.classify_connection(&connection.from, &connection.to) == "network")
                .then_some(connection)
        })
    }

    fn patch_panel_peer(&self, endpoint: &EndpointRef) -> Option<EndpointRef> {
        if endpoint.item.item_type != "patchPanel" || endpoint.hosted_item.is_some() {
            return None;
        }
        let endpoint_id = endpoint.endpoint_id?;
        let panel = self
            .snapshot
            .items
            .iter()
            .find(|item| item.item == endpoint.item)?;
        let port = panel
            .ports
            .iter()
            .find(|port| port.id == endpoint.port_id)?;
        if !is_network_port(&port.port_type) {
            return None;
        }
        let peer = port
            .endpoints
            .iter()
            .find(|candidate| candidate.id != endpoint_id)?;
        Some(EndpointRef {
            item: endpoint.item.clone(),
            port_id: endpoint.port_id,
            endpoint_id: Some(peer.id),
            hosted_item: None,
        })
    }
}

fn item_key(item: &ItemRef) -> String {
    format!("{}:{}", item.item_type, item.id)
}

fn power_connection_finding(
    code: &str,
    connection: &TopologyConnection,
    endpoint: Option<EndpointRef>,
) -> PowerTopologyFinding {
    PowerTopologyFinding {
        id: format!("{code}:{}", connection.id),
        code: code.into(),
        severity: "error".into(),
        item: None,
        connection_id: Some(connection.id),
        endpoint,
    }
}

fn power_item_finding(
    code: &str,
    item: &ItemRef,
    endpoint: Option<EndpointRef>,
) -> PowerTopologyFinding {
    PowerTopologyFinding {
        id: format!("{code}:{}", item_key(item)),
        code: code.into(),
        severity: "warning".into(),
        item: Some(item.clone()),
        connection_id: None,
        endpoint,
    }
}

fn invalid(code: &str, message: &str) -> ConnectionValidation {
    ConnectionValidation {
        ok: false,
        code: Some(code.into()),
        message: Some(message.into()),
    }
}

fn ports_compatible(first: &str, second: &str) -> bool {
    const DISPLAY: [&str; 3] = ["hdmi", "displayport", "mini-displayport"];
    first == second || (DISPLAY.contains(&first) && DISPLAY.contains(&second))
}

fn is_network_port(port_type: &str) -> bool {
    matches!(port_type, "rj45" | "sfp" | "sfp-plus")
}

fn is_display_port(port_type: &str) -> bool {
    matches!(port_type, "hdmi" | "displayport" | "mini-displayport")
}

fn add_graph_edge(
    adjacency: &mut BTreeMap<EndpointRef, BTreeSet<EndpointRef>>,
    first: &EndpointRef,
    second: &EndpointRef,
) {
    adjacency
        .entry(first.clone())
        .or_default()
        .insert(second.clone());
    adjacency
        .entry(second.clone())
        .or_default()
        .insert(first.clone());
}

fn parse_advertised_speed(speed: Option<&str>) -> Option<u32> {
    let normalized = speed?.trim().to_ascii_uppercase().replace(' ', "");
    match normalized.as_str() {
        "1G" | "1GBPS" | "1GBE" | "1000M" | "1000MBPS" | "1000MB/S" => Some(1_000),
        "2.5G" | "2.5GBPS" | "2.5GBE" | "2500M" | "2500MBPS" | "2500MB/S" => Some(2_500),
        "5G" | "5GBPS" | "5GBE" | "5000M" | "5000MBPS" | "5000MB/S" => Some(5_000),
        "10G" | "10GBPS" | "10GBE" | "10000M" | "10000MBPS" | "10000MB/S" => Some(10_000),
        _ => None,
    }
}

fn exposes_direct_ports(item_type: &str) -> bool {
    matches!(
        item_type,
        "server" | "nas" | "pcBuild" | "switch" | "patchPanel" | "monitor" | "ups" | "powerStrip"
    )
}

fn hosts_components(item_type: &str) -> bool {
    matches!(item_type, "server" | "nas" | "pcBuild")
}

fn index_item_ports(
    endpoints: &mut BTreeMap<EndpointRef, EndpointDescriptor>,
    host: &TopologyItem,
    owner: &TopologyItem,
    placed: bool,
) {
    for port in &owner.ports {
        if port.port_type == "barrel" {
            continue;
        }
        let power = power_endpoint(host, owner, port);
        if port.endpoints.is_empty() {
            let endpoint = EndpointRef {
                item: host.item.clone(),
                port_id: port.id,
                endpoint_id: None,
                hosted_item: (host.item != owner.item).then(|| owner.item.clone()),
            };
            endpoints.insert(
                endpoint.clone(),
                EndpointDescriptor {
                    endpoint,
                    host: host.item.clone(),
                    owner: owner.item.clone(),
                    port_type: port.port_type.clone(),
                    slot_number: port.slot_number,
                    side: None,
                    speed: port.speed.clone(),
                    connection_ids: vec![],
                    placed,
                    available: true,
                    power: power.clone(),
                },
            );
            continue;
        }
        for port_endpoint in &port.endpoints {
            let endpoint = EndpointRef {
                item: host.item.clone(),
                port_id: port.id,
                endpoint_id: Some(port_endpoint.id),
                hosted_item: (host.item != owner.item).then(|| owner.item.clone()),
            };
            endpoints.insert(
                endpoint.clone(),
                EndpointDescriptor {
                    endpoint,
                    host: host.item.clone(),
                    owner: owner.item.clone(),
                    port_type: port.port_type.clone(),
                    slot_number: port.slot_number,
                    side: Some(port_endpoint.side.clone()),
                    speed: port.speed.clone(),
                    connection_ids: vec![],
                    placed,
                    available: true,
                    power: power.clone(),
                },
            );
        }
    }
}

fn power_endpoint(
    host: &TopologyItem,
    owner: &TopologyItem,
    port: &TopologyPort,
) -> Option<PowerEndpointDescriptor> {
    if port.port_type == "ac-outlet"
        && matches!(owner.item.item_type.as_str(), "ups" | "powerStrip")
    {
        return Some(PowerEndpointDescriptor {
            direction: "output".into(),
            kind: if owner.item.item_type == "ups" {
                "ups-outlet"
            } else {
                "power-strip-outlet"
            }
            .into(),
            allow_fan_out: owner.allow_outlet_fan_out,
        });
    }
    if port.port_type != "ac-input" {
        return None;
    }
    let kind = if host.item == owner.item {
        match owner.item.item_type.as_str() {
            "monitor" => Some("monitor-input"),
            "powerStrip" => Some("power-strip-input"),
            "nas" if owner.power_configuration.as_deref() == Some("internal-psu") => {
                Some("nas-internal-input")
            }
            _ => None,
        }
    } else {
        match (host.item.item_type.as_str(), owner.item.item_type.as_str()) {
            ("pcBuild", "powerSupply") => Some("pc-power-supply-input"),
            ("server", "powerAdapter") => Some("oem-power-adapter-input"),
            ("nas", "powerAdapter")
                if host.power_configuration.as_deref() == Some("external-adapter") =>
            {
                Some("oem-power-adapter-input")
            }
            _ => None,
        }
    }?;
    Some(PowerEndpointDescriptor {
        direction: "input".into(),
        kind: kind.into(),
        allow_fan_out: false,
    })
}

impl TopologySnapshot {
    pub fn validate(&self) -> Result<(), TopologyError> {
        let mut item_refs = BTreeSet::new();
        for item in &self.items {
            item.item.validate()?;
            if !item_refs.insert(item.item.clone()) {
                return Err(TopologyError::DuplicateItem);
            }
            validate_ports(item)?;
        }

        let mut assignment_ids = BTreeSet::new();
        let mut assigned_items = BTreeSet::new();
        for assignment in &self.assignments {
            if assignment.id == 0 {
                return Err(TopologyError::InvalidId);
            }
            assignment.host.validate()?;
            assignment.item.validate()?;
            if !assignment_ids.insert(assignment.id)
                || !assigned_items.insert(assignment.item.clone())
            {
                return Err(TopologyError::DuplicateAssignment);
            }
            if !item_refs.contains(&assignment.host) || !item_refs.contains(&assignment.item) {
                return Err(TopologyError::MissingItem);
            }
        }

        let mut connection_ids = BTreeSet::new();
        for connection in &self.connections {
            if connection.id == 0 || !connection_ids.insert(connection.id) {
                return Err(if connection.id == 0 {
                    TopologyError::InvalidId
                } else {
                    TopologyError::DuplicateConnection
                });
            }
            validate_endpoint_reference(self, &connection.from)?;
            validate_endpoint_reference(self, &connection.to)?;
            if connection.route.as_ref().is_some_and(|route| {
                route
                    .bend_points
                    .iter()
                    .any(|point| !point.x.is_finite() || !point.y.is_finite())
            }) {
                return Err(TopologyError::InvalidRoute);
            }
        }

        let mut placements = BTreeSet::new();
        for placement in &self.placements {
            placement.validate()?;
            if !item_refs.contains(placement) {
                return Err(TopologyError::MissingItem);
            }
            placements.insert(placement);
        }
        Ok(())
    }
}

fn validate_ports(item: &TopologyItem) -> Result<(), TopologyError> {
    let mut port_ids = BTreeSet::new();
    for port in &item.ports {
        if port.id == 0 || port.slot_number == 0 {
            return Err(TopologyError::InvalidId);
        }
        if port.port_type.trim().is_empty() {
            return Err(TopologyError::EmptyType);
        }
        if !port_ids.insert(port.id) {
            return Err(TopologyError::DuplicatePort);
        }
        let mut endpoint_ids = BTreeSet::new();
        for endpoint in &port.endpoints {
            if endpoint.id == 0 {
                return Err(TopologyError::InvalidId);
            }
            if endpoint.side.trim().is_empty() {
                return Err(TopologyError::EmptyType);
            }
            if !endpoint_ids.insert(endpoint.id) {
                return Err(TopologyError::DuplicatePortEndpoint);
            }
        }
    }
    Ok(())
}

fn validate_endpoint_reference(
    snapshot: &TopologySnapshot,
    endpoint: &EndpointRef,
) -> Result<(), TopologyError> {
    endpoint.item.validate()?;
    if endpoint.port_id == 0 || endpoint.endpoint_id == Some(0) {
        return Err(TopologyError::InvalidId);
    }
    let owner_ref = endpoint.hosted_item.as_ref().unwrap_or(&endpoint.item);
    owner_ref.validate()?;
    if endpoint.hosted_item.as_ref().is_some_and(|hosted| {
        !snapshot
            .assignments
            .iter()
            .any(|assignment| assignment.host == endpoint.item && assignment.item == *hosted)
    }) {
        return Err(TopologyError::InvalidHostedItem);
    }
    snapshot
        .items
        .iter()
        .find(|item| item.item == *owner_ref)
        .ok_or(TopologyError::MissingItem)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(item_type: &str, id: u32, port_id: u32) -> TopologyItem {
        TopologyItem {
            item: ItemRef {
                item_type: item_type.into(),
                id,
            },
            archived: false,
            power_configuration: None,
            allow_outlet_fan_out: false,
            ports: vec![TopologyPort {
                id: port_id,
                key: None,
                port_type: "rj45".into(),
                slot_number: 1,
                speed: Some("1G".into()),
                endpoints: vec![],
            }],
        }
    }

    fn power_item(item_type: &str, id: u32, port_id: u32, port_type: &str) -> TopologyItem {
        TopologyItem {
            item: ItemRef {
                item_type: item_type.into(),
                id,
            },
            archived: false,
            power_configuration: None,
            allow_outlet_fan_out: false,
            ports: vec![TopologyPort {
                id: port_id,
                key: Some(
                    if port_type == "ac-input" {
                        "ac-input"
                    } else {
                        "outlet-1"
                    }
                    .into(),
                ),
                port_type: port_type.into(),
                slot_number: 1,
                speed: None,
                endpoints: vec![],
            }],
        }
    }

    fn connection(id: u32, from: EndpointRef, to: EndpointRef) -> TopologyConnection {
        TopologyConnection {
            id,
            from,
            to,
            connection_type: "power".into(),
            negotiated_speed_mbps: None,
            label: None,
            route: None,
            created_at: String::new(),
        }
    }

    #[test]
    fn parses_only_supported_advertised_network_speeds() {
        assert_eq!(parse_advertised_speed(Some("1G")), Some(1_000));
        assert_eq!(parse_advertised_speed(Some("2.5 Gbps")), Some(2_500));
        assert_eq!(parse_advertised_speed(Some("5000 Mbps")), Some(5_000));
        assert_eq!(parse_advertised_speed(Some("10GbE")), Some(10_000));
        assert_eq!(parse_advertised_speed(Some("40G")), None);
        assert_eq!(parse_advertised_speed(Some("unknown")), None);
        assert_eq!(parse_advertised_speed(None), None);
    }

    #[test]
    fn validates_numeric_direct_and_hosted_relationships() {
        let host = item("server", 1, 1);
        let card = item("network", 1, 2);
        let snapshot = TopologySnapshot {
            items: vec![host.clone(), card.clone()],
            assignments: vec![TopologyAssignment {
                id: 1,
                host: host.item.clone(),
                item: card.item.clone(),
                component_type: "network".into(),
            }],
            connections: vec![TopologyConnection {
                id: 1,
                from: EndpointRef {
                    item: host.item,
                    hosted_item: Some(card.item),
                    port_id: 2,
                    endpoint_id: None,
                },
                to: EndpointRef {
                    item: ItemRef {
                        item_type: "switch".into(),
                        id: 1,
                    },
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                connection_type: "network".into(),
                negotiated_speed_mbps: Some(1000),
                label: None,
                route: None,
                created_at: "2026-01-01T00:00:00.000Z".into(),
            }],
            placements: vec![],
        };
        let mut complete = snapshot;
        complete.items.push(item("switch", 1, 1));
        assert_eq!(complete.validate(), Ok(()));
    }

    #[test]
    fn rejects_hosted_ports_without_the_exact_assignment() {
        let host = item("server", 1, 1);
        let card = item("network", 1, 2);
        let switch = item("switch", 1, 1);
        let snapshot = TopologySnapshot {
            items: vec![host.clone(), card.clone(), switch.clone()],
            assignments: vec![],
            connections: vec![TopologyConnection {
                id: 1,
                from: EndpointRef {
                    item: host.item,
                    hosted_item: Some(card.item),
                    port_id: 2,
                    endpoint_id: None,
                },
                to: EndpointRef {
                    item: switch.item,
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                connection_type: "network".into(),
                negotiated_speed_mbps: None,
                label: None,
                route: None,
                created_at: String::new(),
            }],
            placements: vec![],
        };
        assert_eq!(snapshot.validate(), Err(TopologyError::InvalidHostedItem));
    }

    #[test]
    fn indexes_direct_hosted_sided_and_occupied_endpoints() {
        let host = item("server", 1, 1);
        let card = item("network", 1, 4);
        let mut panel = item("patchPanel", 1, 9);
        panel.ports[0].endpoints = vec![
            TopologyPortSide {
                id: 1,
                side: "front".into(),
            },
            TopologyPortSide {
                id: 2,
                side: "back".into(),
            },
        ];
        let hosted_endpoint = EndpointRef {
            item: host.item.clone(),
            hosted_item: Some(card.item.clone()),
            port_id: 4,
            endpoint_id: None,
        };
        let panel_endpoint = EndpointRef {
            item: panel.item.clone(),
            hosted_item: None,
            port_id: 9,
            endpoint_id: Some(2),
        };
        let snapshot = TopologySnapshot {
            items: vec![host.clone(), card.clone(), panel.clone()],
            assignments: vec![TopologyAssignment {
                id: 1,
                host: host.item.clone(),
                item: card.item.clone(),
                component_type: "network".into(),
            }],
            connections: vec![TopologyConnection {
                id: 7,
                from: hosted_endpoint.clone(),
                to: panel_endpoint.clone(),
                connection_type: "network".into(),
                negotiated_speed_mbps: Some(1000),
                label: None,
                route: None,
                created_at: String::new(),
            }],
            placements: vec![host.item.clone(), panel.item.clone()],
        };

        let index = TopologyIndex::build(snapshot).unwrap();
        assert_eq!(index.endpoints().len(), 4);
        assert_eq!(index.endpoint(&hosted_endpoint).unwrap().owner, card.item);
        assert_eq!(
            index.endpoint(&hosted_endpoint).unwrap().connection_ids,
            vec![7]
        );
        assert_eq!(
            index.endpoint(&panel_endpoint).unwrap().side.as_deref(),
            Some("back")
        );
        assert_eq!(index.host_for_assigned_item(&card.item), Some(&host.item));
        assert!(index.is_placed(&panel.item));
    }

    #[test]
    fn omits_archived_and_unassigned_component_ports() {
        let host = item("server", 1, 1);
        let card = item("network", 1, 4);
        let mut archived_switch = item("switch", 1, 1);
        archived_switch.archived = true;
        let snapshot = TopologySnapshot {
            items: vec![host, card, archived_switch],
            assignments: vec![],
            connections: vec![],
            placements: vec![],
        };
        let index = TopologyIndex::build(snapshot).unwrap();

        assert_eq!(index.endpoints().len(), 1);
        assert_eq!(index.endpoints()[0].endpoint.item.item_type, "server");
    }

    #[test]
    fn rejects_connections_to_unassigned_component_ports() {
        let card = item("network", 1, 4);
        let switch = item("switch", 1, 1);
        let snapshot = TopologySnapshot {
            items: vec![card.clone(), switch.clone()],
            assignments: vec![],
            connections: vec![TopologyConnection {
                id: 1,
                from: EndpointRef {
                    item: card.item,
                    hosted_item: None,
                    port_id: 4,
                    endpoint_id: None,
                },
                to: EndpointRef {
                    item: switch.item,
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                connection_type: "network".into(),
                negotiated_speed_mbps: None,
                label: None,
                route: None,
                created_at: String::new(),
            }],
            placements: vec![],
        };

        assert_eq!(
            TopologyIndex::build(snapshot).unwrap_err(),
            TopologyError::UnavailableEndpoint
        );
    }

    #[test]
    fn indexed_occupancy_matches_brute_force_for_seeded_graph() {
        let items = (1..=100)
            .map(|id| item("switch", id, 1))
            .collect::<Vec<_>>();
        let connections = (1..=50)
            .map(|id| TopologyConnection {
                id,
                from: EndpointRef {
                    item: ItemRef {
                        item_type: "switch".into(),
                        id,
                    },
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                to: EndpointRef {
                    item: ItemRef {
                        item_type: "switch".into(),
                        id: id + 50,
                    },
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                connection_type: "network".into(),
                negotiated_speed_mbps: Some(1000),
                label: None,
                route: None,
                created_at: String::new(),
            })
            .collect::<Vec<_>>();
        let snapshot = TopologySnapshot {
            items,
            assignments: vec![],
            connections: connections.clone(),
            placements: vec![],
        };
        let index = TopologyIndex::build(snapshot).unwrap();

        for descriptor in index.endpoints() {
            let brute_force = connections
                .iter()
                .filter(|connection| {
                    connection.from == descriptor.endpoint || connection.to == descriptor.endpoint
                })
                .map(|connection| connection.id)
                .collect::<Vec<_>>();
            assert_eq!(descriptor.connection_ids, brute_force);
        }
    }

    #[test]
    fn filters_available_placed_and_compatible_destinations() {
        let mut server = item("server", 1, 1);
        server.ports[0].port_type = "displayport".into();
        let mut monitor = item("monitor", 1, 1);
        monitor.ports[0].port_type = "hdmi".into();
        let mut occupied_monitor = item("monitor", 2, 1);
        occupied_monitor.ports[0].port_type = "hdmi".into();
        let mut unplaced_monitor = item("monitor", 3, 1);
        unplaced_monitor.ports[0].port_type = "hdmi".into();
        let mut switch = item("switch", 1, 1);
        switch.ports[0].port_type = "rj45".into();
        let source = EndpointRef {
            item: server.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let occupied = EndpointRef {
            item: occupied_monitor.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let snapshot = TopologySnapshot {
            items: vec![
                server.clone(),
                monitor.clone(),
                occupied_monitor.clone(),
                unplaced_monitor,
                switch,
            ],
            assignments: vec![],
            connections: vec![TopologyConnection {
                id: 1,
                from: occupied.clone(),
                to: EndpointRef {
                    item: ItemRef {
                        item_type: "switch".into(),
                        id: 1,
                    },
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                connection_type: "other".into(),
                negotiated_speed_mbps: None,
                label: None,
                route: None,
                created_at: String::new(),
            }],
            placements: vec![
                server.item,
                monitor.item.clone(),
                occupied_monitor.item,
                ItemRef {
                    item_type: "switch".into(),
                    id: 1,
                },
            ],
        };
        let index = TopologyIndex::build(snapshot).unwrap();
        let destinations = index.compatible_destinations(&source);

        assert_eq!(destinations.len(), 1);
        assert_eq!(destinations[0].host, monitor.item);
        assert!(destinations[0].available);
    }

    #[test]
    fn validates_power_direction_occupancy_and_fan_out() {
        let mut ups = item("ups", 1, 1);
        ups.ports[0].port_type = "ac-outlet".into();
        ups.allow_outlet_fan_out = true;
        let mut strip = item("powerStrip", 1, 1);
        strip.ports[0].key = Some("ac-input".into());
        strip.ports[0].port_type = "ac-input".into();
        let mut monitor = item("monitor", 1, 1);
        monitor.ports[0].key = Some("ac-input".into());
        monitor.ports[0].port_type = "ac-input".into();
        let output = EndpointRef {
            item: ups.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let strip_input = EndpointRef {
            item: strip.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let monitor_input = EndpointRef {
            item: monitor.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let snapshot = TopologySnapshot {
            items: vec![ups.clone(), strip.clone(), monitor.clone()],
            assignments: vec![],
            connections: vec![TopologyConnection {
                id: 1,
                from: output.clone(),
                to: strip_input.clone(),
                connection_type: "power".into(),
                negotiated_speed_mbps: None,
                label: None,
                route: None,
                created_at: String::new(),
            }],
            placements: vec![ups.item, strip.item, monitor.item],
        };
        let index = TopologyIndex::build(snapshot).unwrap();

        assert!(index.endpoint(&output).unwrap().available);
        assert!(!index.endpoint(&strip_input).unwrap().available);
        assert!(index.validate_connection(&output, &monitor_input).ok);
        assert_eq!(
            index
                .validate_connection(&strip_input, &monitor_input)
                .code
                .as_deref(),
            Some("invalid-power-direction")
        );
        assert_eq!(
            index
                .validate_connection(&output, &strip_input)
                .code
                .as_deref(),
            Some("destination-occupied")
        );
    }

    #[test]
    fn negotiates_active_speeds_across_passive_patch_panel_continuity() {
        let mut server = item("server", 1, 1);
        server.ports[0].speed = Some("1G".into());
        let mut switch = item("switch", 1, 1);
        switch.ports[0].speed = Some("2.5 Gbps".into());
        let mut panel = item("patchPanel", 1, 1);
        panel.ports[0].speed = None;
        panel.ports[0].endpoints = vec![
            TopologyPortSide {
                id: 1,
                side: "front".into(),
            },
            TopologyPortSide {
                id: 2,
                side: "back".into(),
            },
        ];
        let server_endpoint = EndpointRef {
            item: server.item.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: None,
        };
        let switch_endpoint = EndpointRef {
            item: switch.item.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: None,
        };
        let front = EndpointRef {
            item: panel.item.clone(),
            port_id: 1,
            endpoint_id: Some(1),
            hosted_item: None,
        };
        let back = EndpointRef {
            item: panel.item.clone(),
            port_id: 1,
            endpoint_id: Some(2),
            hosted_item: None,
        };
        let connection = |id, from, to| TopologyConnection {
            id,
            from,
            to,
            connection_type: "other".into(),
            negotiated_speed_mbps: Some(10_000),
            label: None,
            route: None,
            created_at: String::new(),
        };
        let snapshot = TopologySnapshot {
            items: vec![server.clone(), switch.clone(), panel.clone()],
            assignments: vec![],
            connections: vec![
                connection(1, server_endpoint.clone(), back),
                connection(2, front, switch_endpoint),
            ],
            placements: vec![server.item, switch.item, panel.item],
        };
        let index = TopologyIndex::build(snapshot).unwrap();
        let states = index.connection_derived_states();

        assert_eq!(
            states,
            vec![
                ConnectionDerivedState {
                    connection_id: 1,
                    connection_type: "network".into(),
                    negotiated_speed_mbps: Some(1_000),
                },
                ConnectionDerivedState {
                    connection_id: 2,
                    connection_type: "network".into(),
                    negotiated_speed_mbps: Some(1_000),
                },
            ]
        );
        let trace = index.trace_network_path(&server_endpoint).unwrap();
        assert!(trace.complete);
        assert_eq!(
            trace
                .steps
                .iter()
                .map(|step| (step.endpoint.item.item_type.as_str(), step.state.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("server", "connected"),
                ("patchPanel", "connected"),
                ("patchPanel", "internal"),
                ("switch", "connected"),
            ]
        );
    }

    #[test]
    fn keeps_open_active_speed_and_omits_disconnected_passive_speed() {
        let mut switch = item("switch", 1, 1);
        switch.ports[0].port_type = "sfp-plus".into();
        switch.ports[0].speed = None;
        let mut first_panel = item("patchPanel", 1, 1);
        let mut second_panel = item("patchPanel", 2, 1);
        let mut third_panel = item("patchPanel", 3, 1);
        let mut fourth_panel = item("patchPanel", 4, 1);
        for panel in [
            &mut first_panel,
            &mut second_panel,
            &mut third_panel,
            &mut fourth_panel,
        ] {
            panel.ports[0].speed = None;
            panel.ports[0].endpoints = vec![
                TopologyPortSide {
                    id: 1,
                    side: "front".into(),
                },
                TopologyPortSide {
                    id: 2,
                    side: "back".into(),
                },
            ];
        }
        first_panel.ports[0].port_type = "sfp-plus".into();
        second_panel.ports[0].port_type = "sfp-plus".into();
        let endpoint = |item: &TopologyItem, endpoint_id| EndpointRef {
            item: item.item.clone(),
            port_id: 1,
            endpoint_id,
            hosted_item: None,
        };
        let snapshot = TopologySnapshot {
            items: vec![
                switch.clone(),
                first_panel.clone(),
                second_panel.clone(),
                third_panel.clone(),
                fourth_panel.clone(),
            ],
            assignments: vec![],
            connections: vec![
                TopologyConnection {
                    id: 1,
                    from: endpoint(&switch, None),
                    to: endpoint(&first_panel, Some(1)),
                    connection_type: "network".into(),
                    negotiated_speed_mbps: None,
                    label: None,
                    route: None,
                    created_at: String::new(),
                },
                TopologyConnection {
                    id: 2,
                    from: endpoint(&first_panel, Some(2)),
                    to: endpoint(&second_panel, Some(1)),
                    connection_type: "network".into(),
                    negotiated_speed_mbps: Some(10_000),
                    label: None,
                    route: None,
                    created_at: String::new(),
                },
                TopologyConnection {
                    id: 3,
                    from: endpoint(&third_panel, Some(1)),
                    to: endpoint(&fourth_panel, Some(1)),
                    connection_type: "network".into(),
                    negotiated_speed_mbps: Some(10_000),
                    label: None,
                    route: None,
                    created_at: String::new(),
                },
            ],
            placements: vec![
                switch.item,
                first_panel.item,
                second_panel.item,
                third_panel.item,
                fourth_panel.item,
            ],
        };
        let states = TopologyIndex::build(snapshot)
            .unwrap()
            .connection_derived_states();

        assert_eq!(states[0].negotiated_speed_mbps, Some(10_000));
        assert_eq!(states[1].negotiated_speed_mbps, Some(10_000));
        assert_eq!(states[2].negotiated_speed_mbps, None);
    }

    #[test]
    fn negotiates_assigned_nas_nic_at_five_gigabit() {
        let nas = item("nas", 1, 1);
        let mut nic = item("network", 1, 1);
        nic.ports[0].speed = Some("5G".into());
        let mut switch = item("switch", 1, 1);
        switch.ports[0].speed = Some("10G".into());
        let hosted = EndpointRef {
            item: nas.item.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: Some(nic.item.clone()),
        };
        let switch_endpoint = EndpointRef {
            item: switch.item.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: None,
        };
        let snapshot = TopologySnapshot {
            items: vec![nas.clone(), nic.clone(), switch.clone()],
            assignments: vec![TopologyAssignment {
                id: 1,
                host: nas.item.clone(),
                item: nic.item,
                component_type: "network".into(),
            }],
            connections: vec![TopologyConnection {
                id: 1,
                from: hosted,
                to: switch_endpoint,
                connection_type: "network".into(),
                negotiated_speed_mbps: None,
                label: None,
                route: None,
                created_at: String::new(),
            }],
            placements: vec![nas.item, switch.item],
        };

        assert_eq!(
            TopologyIndex::build(snapshot)
                .unwrap()
                .connection_derived_states()[0]
                .negotiated_speed_mbps,
            Some(5_000)
        );
    }

    #[test]
    fn returns_an_incomplete_open_network_trace() {
        let server = item("server", 1, 1);
        let endpoint = EndpointRef {
            item: server.item.clone(),
            port_id: 1,
            endpoint_id: None,
            hosted_item: None,
        };
        let index = TopologyIndex::build(TopologySnapshot {
            items: vec![server.clone()],
            assignments: vec![],
            connections: vec![],
            placements: vec![server.item],
        })
        .unwrap();

        assert_eq!(
            index.trace_network_path(&endpoint),
            Some(NetworkTrace {
                start: endpoint.clone(),
                steps: vec![NetworkTraceStep {
                    endpoint,
                    state: "open".into(),
                    connection_id: None,
                }],
                complete: false,
            })
        );
    }

    #[test]
    fn derives_power_endpoints_and_placed_load_findings() {
        let ups = power_item("ups", 1, 1, "ac-outlet");
        let monitor = power_item("monitor", 1, 1, "ac-input");
        let server = TopologyItem {
            item: ItemRef {
                item_type: "server".into(),
                id: 1,
            },
            archived: false,
            power_configuration: None,
            allow_outlet_fan_out: false,
            ports: vec![],
        };
        let adapter = power_item("powerAdapter", 1, 1, "ac-input");
        let server_input = EndpointRef {
            item: server.item.clone(),
            hosted_item: Some(adapter.item.clone()),
            port_id: 1,
            endpoint_id: None,
        };
        let index = TopologyIndex::build(TopologySnapshot {
            items: vec![
                ups.clone(),
                monitor.clone(),
                server.clone(),
                adapter.clone(),
            ],
            assignments: vec![TopologyAssignment {
                id: 1,
                host: server.item.clone(),
                item: adapter.item,
                component_type: "powerAdapter".into(),
            }],
            connections: vec![connection(
                1,
                EndpointRef {
                    item: ups.item.clone(),
                    hosted_item: None,
                    port_id: 1,
                    endpoint_id: None,
                },
                server_input.clone(),
            )],
            placements: vec![ups.item, monitor.item.clone(), server.item.clone()],
        })
        .unwrap();
        let topology = index.power_topology();

        assert_eq!(topology.endpoints.len(), 3);
        assert_eq!(
            topology
                .findings
                .iter()
                .map(|finding| (finding.code.as_str(), finding.item.as_ref()))
                .collect::<Vec<_>>(),
            vec![("power.monitor.unpowered", Some(&monitor.item))]
        );
        assert!(
            topology
                .endpoints
                .iter()
                .any(|endpoint| endpoint.endpoint == server_input)
        );
    }

    #[test]
    fn reports_power_connection_integrity_findings_deterministically() {
        let mut ups = power_item("ups", 1, 1, "ac-outlet");
        ups.ports.push(TopologyPort {
            id: 2,
            key: Some("outlet-2".into()),
            port_type: "ac-outlet".into(),
            slot_number: 2,
            speed: None,
            endpoints: vec![],
        });
        let first_monitor = power_item("monitor", 1, 1, "ac-input");
        let second_monitor = power_item("monitor", 2, 1, "ac-input");
        let outlet = EndpointRef {
            item: ups.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let second_outlet = EndpointRef {
            port_id: 2,
            ..outlet.clone()
        };
        let first_input = EndpointRef {
            item: first_monitor.item.clone(),
            hosted_item: None,
            port_id: 1,
            endpoint_id: None,
        };
        let second_input = EndpointRef {
            item: second_monitor.item.clone(),
            ..first_input.clone()
        };
        let stale = EndpointRef {
            port_id: 99,
            ..outlet.clone()
        };
        let mut connections = vec![
            connection(1, outlet.clone(), first_input.clone()),
            connection(2, outlet.clone(), second_input.clone()),
            connection(3, second_outlet, first_input.clone()),
            connection(4, first_input.clone(), second_input.clone()),
            connection(5, stale.clone(), second_input.clone()),
            connection(6, outlet, second_input),
        ];
        connections[5].connection_type = "other".into();
        let index = TopologyIndex::build(TopologySnapshot {
            items: vec![ups, first_monitor, second_monitor],
            assignments: vec![],
            connections,
            placements: vec![],
        })
        .unwrap();

        let findings = index.power_topology().findings;
        let codes = findings
            .iter()
            .map(|finding| finding.code.as_str())
            .collect::<Vec<_>>();
        assert!(codes.contains(&"power.connection.output-fan-out"));
        assert!(codes.contains(&"power.connection.duplicate-input"));
        assert!(codes.contains(&"power.connection.invalid-direction"));
        assert!(codes.contains(&"power.connection.stale-endpoint"));
        assert!(codes.contains(&"power.connection.misclassified"));
        assert_eq!(
            findings
                .iter()
                .find(|finding| finding.code == "power.connection.stale-endpoint")
                .and_then(|finding| finding.endpoint.as_ref()),
            Some(&stale)
        );
    }

    #[test]
    fn reports_missing_power_components_only_for_placed_hosts() {
        let server = TopologyItem {
            item: ItemRef {
                item_type: "server".into(),
                id: 1,
            },
            archived: false,
            power_configuration: None,
            allow_outlet_fan_out: false,
            ports: vec![],
        };
        let spare = TopologyItem {
            item: ItemRef {
                item_type: "pcBuild".into(),
                id: 1,
            },
            ..server.clone()
        };
        let index = TopologyIndex::build(TopologySnapshot {
            items: vec![server.clone(), spare],
            assignments: vec![],
            connections: vec![],
            placements: vec![server.item.clone()],
        })
        .unwrap();

        assert_eq!(
            index.power_topology().findings,
            vec![power_item_finding(
                "power.host.missing-input",
                &server.item,
                None,
            )]
        );
    }
}
