use std::{collections::BTreeSet, fmt};

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
}
