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
                let descriptor = endpoints
                    .get_mut(endpoint)
                    .ok_or(TopologyError::UnavailableEndpoint)?;
                descriptor.connection_ids.push(connection.id);
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
            validate_endpoint(self, &connection.from)?;
            validate_endpoint(self, &connection.to)?;
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

fn validate_endpoint(
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
    let owner = snapshot
        .items
        .iter()
        .find(|item| item.item == *owner_ref)
        .ok_or(TopologyError::MissingItem)?;
    let port = owner
        .ports
        .iter()
        .find(|port| port.id == endpoint.port_id)
        .ok_or(TopologyError::InvalidPort)?;
    match endpoint.endpoint_id {
        Some(endpoint_id)
            if port
                .endpoints
                .iter()
                .any(|candidate| candidate.id == endpoint_id) =>
        {
            Ok(())
        }
        Some(_) => Err(TopologyError::InvalidPortEndpoint),
        None if port.endpoints.is_empty() => Ok(()),
        None => Err(TopologyError::InvalidPortEndpoint),
    }
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
}
