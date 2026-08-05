use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap},
    fmt,
};

use homelab_geometry::{GeometryError, Point, Rect, Segment, Side};
use serde::{Deserialize, Serialize};

const MIN_LANE_OFFSET: f64 = 0.0;
pub const DEFAULT_ROUTING_GRID: f64 = 12.0;
pub const MIN_ROUTING_MARGIN: f64 = 96.0;
const EQUIPMENT_ROUTE_CLEARANCE: f64 = 6.0;
const MIN_COLLISION_DETOUR_BUDGET_IN_GRIDS: f64 = 4.0;
const MAX_COLLISION_DETOUR_BUDGET_IN_GRIDS: f64 = 24.0;
const COLLISION_DETOUR_RATIO: f64 = 0.15;
const MAX_ROUTE_RECALCULATIONS_PER_PLAN: usize = 4;
const MAX_VISIBILITY_SEARCH_STATES: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoutingError {
    Geometry(GeometryError),
    InvalidConnectionId,
    InvalidSegmentIndex,
    InvalidBendIndex,
    InvalidLaneOffset,
    InvalidSnapGrid,
    InvalidSnapThreshold,
    AnchorOnEndpoint,
    EmptyItemId,
    DuplicateObstacleId,
    InvalidEndpointCandidates,
    NoRoute,
}

impl fmt::Display for RoutingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Geometry(error) => error.fmt(formatter),
            Self::InvalidConnectionId => formatter.write_str("Connection ID must be positive."),
            Self::InvalidSegmentIndex => formatter.write_str("Route segment does not exist."),
            Self::InvalidBendIndex => formatter.write_str("Manual bend does not exist."),
            Self::InvalidLaneOffset => {
                formatter.write_str("Route lane offset must be finite and non-negative.")
            }
            Self::InvalidSnapGrid => {
                formatter.write_str("Route snap grid must be finite and positive.")
            }
            Self::InvalidSnapThreshold => {
                formatter.write_str("Endpoint snap threshold must be finite and non-negative.")
            }
            Self::AnchorOnEndpoint => {
                formatter.write_str("A manual bend cannot replace a route endpoint.")
            }
            Self::EmptyItemId => formatter.write_str("Route item IDs must not be empty."),
            Self::DuplicateObstacleId => {
                formatter.write_str("Route obstacle item IDs must be unique.")
            }
            Self::InvalidEndpointCandidates => {
                formatter.write_str("Route endpoint candidates must contain unique valid points.")
            }
            Self::NoRoute => formatter.write_str("No bounded orthogonal route was found."),
        }
    }
}

impl std::error::Error for RoutingError {}

impl From<GeometryError> for RoutingError {
    fn from(error: GeometryError) -> Self {
        Self::Geometry(error)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RouteDefinition {
    pub connection_id: u32,
    pub source: Point,
    pub target: Point,
    pub source_side: Side,
    pub target_side: Side,
    pub lane_offset: f64,
    pub manual_bends: Vec<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RouteEndpointCandidate {
    pub point: Point,
    pub side: Side,
}

impl RouteDefinition {
    pub fn validate(&self) -> Result<(), RoutingError> {
        if self.connection_id == 0 {
            return Err(RoutingError::InvalidConnectionId);
        }
        self.source.validate()?;
        self.target.validate()?;
        validate_lane_offset(self.lane_offset)?;
        for bend in &self.manual_bends {
            bend.validate()?;
            if points_equal(*bend, self.source) || points_equal(*bend, self.target) {
                return Err(RoutingError::AnchorOnEndpoint);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutedPath {
    pub connection_id: u32,
    pub points: Vec<Point>,
    pub manual_anchor_point_indexes: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutePatch {
    pub connection_id: u32,
    pub bend_points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RouteEdit {
    pub route: RoutedPath,
    pub forward: RoutePatch,
    pub inverse: RoutePatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RouteObstacle {
    pub item_id: String,
    pub bounds: Rect,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ReservedSegment {
    pub start: Point,
    pub end: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObstacleRouteRequest {
    pub definition: RouteDefinition,
    #[serde(default)]
    pub source_candidates: Vec<RouteEndpointCandidate>,
    #[serde(default)]
    pub target_candidates: Vec<RouteEndpointCandidate>,
    #[serde(default)]
    pub source_side_constraint: Option<Side>,
    #[serde(default)]
    pub target_side_constraint: Option<Side>,
    #[serde(default)]
    pub previous_source_side: Option<Side>,
    #[serde(default)]
    pub previous_target_side: Option<Side>,
    pub source_item_id: String,
    pub target_item_id: String,
    pub obstacles: Vec<RouteObstacle>,
    #[serde(default)]
    pub reserved_segments: Vec<ReservedSegment>,
    pub snap_to_grid: bool,
    #[serde(default = "default_routing_grid")]
    pub grid_size: f64,
    #[serde(default)]
    pub previous_valid_route: Option<RoutedPath>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RouteWarning {
    SearchExhausted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RouteRepairReason {
    TerminalOverlap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObstacleRouteResult {
    pub route: RoutedPath,
    pub source_side: Side,
    pub target_side: Side,
    pub used_fallback: bool,
    pub warning: Option<RouteWarning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repaired_bend_points: Option<Vec<Point>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair_reason: Option<RouteRepairReason>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LaneRouteRequest {
    pub avoid_cable_overlap: bool,
    pub request: ObstacleRouteRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CableRoutePlanRequest {
    pub obstacles: Vec<RouteObstacle>,
    pub requests: Vec<LaneRouteRequest>,
    #[serde(default)]
    pub seed: Option<CableRouteCacheSeed>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedLaneRouteSeed {
    pub input: LaneRouteRequest,
    pub result: ObstacleRouteResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CableRouteCacheSeed {
    pub obstacles: Vec<RouteObstacle>,
    pub entries: Vec<CachedLaneRouteSeed>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CableRouteFailure {
    pub connection_id: u32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CableRouteRepair {
    pub connection_id: u32,
    pub bend_points: Vec<Point>,
    pub reason: RouteRepairReason,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CableRoutePlan {
    pub routes: Vec<ObstacleRouteResult>,
    pub recalculated_connection_ids: Vec<u32>,
    pub deferred_connection_ids: Vec<u32>,
    pub failures: Vec<CableRouteFailure>,
    pub repairs: Vec<CableRouteRepair>,
}

#[derive(Debug, Clone, PartialEq)]
struct CachedLaneRoute {
    input: LaneRouteRequest,
    result: ObstacleRouteResult,
}

fn sorted_request_inputs(request: &CableRoutePlanRequest) -> Vec<LaneRouteRequest> {
    let mut sorted = request.requests.clone();
    sorted.sort_by_key(|entry| entry.request.definition.connection_id);
    for entry in &mut sorted {
        entry.request.previous_valid_route = None;
        entry.request.obstacles.clear();
    }
    sorted
}

#[derive(Debug, Clone, Default)]
pub struct RoutePlanner {
    cache: BTreeMap<u32, CachedLaneRoute>,
    obstacles: Vec<RouteObstacle>,
    pending_obstacles: Option<Vec<RouteObstacle>>,
    pending_requests: Option<Vec<LaneRouteRequest>>,
    pending_connection_ids: BTreeSet<u32>,
    pending_reservation_changes: Vec<ReservedSegment>,
}

impl RoutePlanner {
    pub fn plan(
        &mut self,
        request: &CableRoutePlanRequest,
    ) -> Result<CableRoutePlan, RoutingError> {
        validate_obstacles(&request.obstacles)?;
        if self.cache.is_empty()
            && let Some(seed) = &request.seed
        {
            self.hydrate(seed);
        }
        let changed_obstacles = changed_obstacle_bounds(&self.obstacles, &request.obstacles);
        let mut sorted = request.requests.clone();
        sorted.sort_by_key(|entry| entry.request.definition.connection_id);
        let mut desired_ids = BTreeSet::new();
        for entry in &mut sorted {
            let connection_id = entry.request.definition.connection_id;
            if !desired_ids.insert(connection_id) {
                return Err(RoutingError::InvalidConnectionId);
            }
            entry.request.previous_valid_route = None;
            entry.request.obstacles.clear();
            validate_obstacle_request_base(&entry.request)?;
        }

        let continuing = self
            .pending_obstacles
            .as_ref()
            .is_some_and(|pending| pending == &request.obstacles)
            && self
                .pending_requests
                .as_ref()
                .is_some_and(|pending| pending == &sorted);
        if !continuing {
            self.pending_obstacles = None;
            self.pending_requests = None;
            self.pending_connection_ids.clear();
            self.pending_reservation_changes.clear();
        }

        let mut changed_reservations = self.pending_reservation_changes.clone();
        changed_reservations.extend(
            self.cache
                .iter()
                .filter(|(id, _)| !desired_ids.contains(id))
                .flat_map(|(_, cached)| reservable_segments(&cached.result.route.points)),
        );
        self.cache.retain(|id, _| desired_ids.contains(id));
        let mut reservations = Vec::new();
        let mut recalculated_connection_ids = Vec::new();
        let mut deferred_connection_ids = Vec::new();
        let mut failures = Vec::new();

        for entry in sorted {
            let connection_id = entry.request.definition.connection_id;
            let previous = self.cache.get(&connection_id).cloned();
            let input_changed = previous.as_ref().is_none_or(|cached| cached.input != entry);
            let obstacle_changed = previous.as_ref().is_some_and(|cached| {
                changed_obstacles.iter().any(|(item_id, bounds)| {
                    item_id == &entry.request.source_item_id
                        || item_id == &entry.request.target_item_id
                        || route_near_rect(&cached.result.route.points, *bounds)
                })
            });
            let reservation_changed = entry.avoid_cable_overlap
                && previous.as_ref().is_some_and(|cached| {
                    reservable_segments(&cached.result.route.points)
                        .iter()
                        .any(|segment| {
                            changed_reservations.iter().any(|changed| {
                                reservation_change_affects_route(
                                    *segment,
                                    *changed,
                                    entry.request.grid_size,
                                )
                            })
                        })
                });
            let should_recalculate = if continuing {
                self.pending_connection_ids.contains(&connection_id)
            } else {
                input_changed || obstacle_changed || reservation_changed
            };
            if should_recalculate
                && recalculated_connection_ids.len() >= MAX_ROUTE_RECALCULATIONS_PER_PLAN
            {
                deferred_connection_ids.push(connection_id);
                if let Some(cached) = previous {
                    reservations.extend(reservable_segments(&cached.result.route.points));
                }
                continue;
            }
            let result = if should_recalculate {
                let mut route_request = entry.request.clone();
                route_request.obstacles.clone_from(&request.obstacles);
                route_request.previous_valid_route = previous
                    .as_ref()
                    .filter(|cached| cached.input == entry)
                    .map(|cached| cached.result.route.clone());
                route_request.previous_source_side =
                    previous.as_ref().map(|cached| cached.result.source_side);
                route_request.previous_target_side =
                    previous.as_ref().map(|cached| cached.result.target_side);
                if entry.avoid_cable_overlap {
                    route_request
                        .reserved_segments
                        .extend(reservations.iter().copied());
                }
                let result = match route_around_obstacles(&route_request) {
                    Ok(result) => result,
                    Err(RoutingError::NoRoute) => {
                        if let Some(cached) = previous
                            .as_ref()
                            .filter(|cached| route_safe_for_result(&cached.result, &route_request))
                        {
                            let mut retained = cached.result.clone();
                            retained.used_fallback = true;
                            retained.warning = Some(RouteWarning::SearchExhausted);
                            retained
                        } else {
                            failures.push(CableRouteFailure {
                                connection_id,
                                message: RoutingError::NoRoute.to_string(),
                            });
                            self.cache.remove(&connection_id);
                            recalculated_connection_ids.push(connection_id);
                            continue;
                        }
                    }
                    Err(error) => return Err(error),
                };
                let route_changed = previous.as_ref().is_none_or(|cached| {
                    cached.result.route != result.route
                        || cached.result.source_side != result.source_side
                        || cached.result.target_side != result.target_side
                });
                if route_changed {
                    if let Some(cached) = &previous {
                        changed_reservations
                            .extend(reservable_segments(&cached.result.route.points));
                    }
                    changed_reservations.extend(reservable_segments(&result.route.points));
                }
                recalculated_connection_ids.push(connection_id);
                self.cache.insert(
                    connection_id,
                    CachedLaneRoute {
                        input: entry.clone(),
                        result: result.clone(),
                    },
                );
                result
            } else if let Some(previous) = previous {
                previous.result
            } else {
                // Failed routes have no cache entry, but must not be retried during
                // every continuation batch in the same bounded routing pass.
                continue;
            };
            reservations.extend(reservable_segments(&result.route.points));
        }
        let routes = self
            .cache
            .iter()
            .filter(|(connection_id, _)| desired_ids.contains(connection_id))
            .map(|(_, cached)| cached.result.clone())
            .collect::<Vec<_>>();
        let repairs = routes
            .iter()
            .filter_map(|result| {
                Some(CableRouteRepair {
                    connection_id: result.route.connection_id,
                    bend_points: result.repaired_bend_points.clone()?,
                    reason: result.repair_reason?,
                })
            })
            .collect();
        if deferred_connection_ids.is_empty() {
            self.obstacles.clone_from(&request.obstacles);
            self.pending_obstacles = None;
            self.pending_requests = None;
            self.pending_connection_ids.clear();
            self.pending_reservation_changes.clear();
        } else {
            self.pending_obstacles = Some(request.obstacles.clone());
            self.pending_requests = Some(sorted_request_inputs(request));
            self.pending_connection_ids = deferred_connection_ids.iter().copied().collect();
            self.pending_reservation_changes = changed_reservations;
        }

        Ok(CableRoutePlan {
            routes,
            recalculated_connection_ids,
            deferred_connection_ids,
            failures,
            repairs,
        })
    }

    fn hydrate(&mut self, seed: &CableRouteCacheSeed) {
        if validate_obstacles(&seed.obstacles).is_err() {
            return;
        }
        let mut cache = BTreeMap::new();
        for entry in &seed.entries {
            let mut input = entry.input.clone();
            input.request.obstacles.clear();
            input.request.previous_valid_route = None;
            let connection_id = input.request.definition.connection_id;
            let selected = selected_definition(&input.request, &entry.result);
            if validate_obstacle_request_base(&input.request).is_err()
                || connection_id == 0
                || entry.result.route.connection_id != connection_id
                || selected.as_ref().is_none_or(|definition| {
                    !route_structure_valid(&entry.result.route.points, definition)
                })
                || route_intersects_equipment_clearance(
                    &entry.result.route.points,
                    &seed.obstacles,
                    &input.request.source_item_id,
                    &input.request.target_item_id,
                )
                || cache.contains_key(&connection_id)
            {
                continue;
            }
            cache.insert(
                connection_id,
                CachedLaneRoute {
                    input,
                    result: entry.result.clone(),
                },
            );
        }
        if !cache.is_empty() {
            self.cache = cache;
            self.obstacles.clone_from(&seed.obstacles);
        }
    }

    pub fn clear(&mut self) {
        self.cache.clear();
        self.pending_obstacles = None;
        self.pending_requests = None;
        self.pending_connection_ids.clear();
        self.pending_reservation_changes.clear();
        self.obstacles.clear();
    }

    pub fn preview_move_segment(
        &self,
        connection_id: u32,
        segment_index: u16,
        coordinate: f64,
        snap_grid: Option<f64>,
        endpoint_snap_threshold: f64,
    ) -> Result<RouteEdit, RoutingError> {
        let cached = self
            .cache
            .get(&connection_id)
            .ok_or(RoutingError::InvalidConnectionId)?;
        let definition = selected_definition(&cached.input.request, &cached.result)
            .ok_or(RoutingError::InvalidEndpointCandidates)?;
        preview_move_routed_segment(
            &definition,
            &cached.result.route,
            segment_index,
            coordinate,
            snap_grid,
            endpoint_snap_threshold,
        )
    }

    pub fn preview_insert_manual_bend(
        &self,
        connection_id: u32,
        segment_index: u16,
        pointer: Point,
        snap_grid: Option<f64>,
    ) -> Result<RouteEdit, RoutingError> {
        let cached = self
            .cache
            .get(&connection_id)
            .ok_or(RoutingError::InvalidConnectionId)?;
        let definition = selected_definition(&cached.input.request, &cached.result)
            .ok_or(RoutingError::InvalidEndpointCandidates)?;
        preview_insert_routed_bend(
            &definition,
            &cached.result.route,
            segment_index,
            pointer,
            snap_grid,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Orientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum SearchDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct SearchKey {
    node_id: usize,
    direction: SearchDirection,
    phase: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct SearchCost {
    distance: f64,
    bends: u32,
    overlap_distance: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct SearchBest {
    cost: SearchCost,
    lexical_path: String,
}

#[derive(Debug, Clone, PartialEq)]
struct QueueEntry {
    key: SearchKey,
    cost: SearchCost,
    lexical_path: String,
}

impl Eq for QueueEntry {}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        compare_search_best(
            &SearchBest {
                cost: other.cost,
                lexical_path: other.lexical_path.clone(),
            },
            &SearchBest {
                cost: self.cost,
                lexical_path: self.lexical_path.clone(),
            },
        )
    }
}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, Copy)]
struct GraphEdge {
    to: usize,
    direction: SearchDirection,
    distance: f64,
    overlap_distance: f64,
}

#[derive(Debug)]
struct VisibilityGraph {
    nodes: Vec<Point>,
    edges: Vec<Vec<GraphEdge>>,
    node_ids: HashMap<(u64, u64), usize>,
}

#[derive(Debug, Clone, Copy)]
struct SearchBounds {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl SearchBounds {
    fn contains(self, point: Point) -> bool {
        point.x >= self.left
            && point.x <= self.right
            && point.y >= self.top
            && point.y <= self.bottom
    }

    fn intersects(self, rect: Rect) -> bool {
        rect.right() >= self.left
            && rect.x <= self.right
            && rect.bottom() >= self.top
            && rect.y <= self.bottom
    }
}

const fn default_routing_grid() -> f64 {
    DEFAULT_ROUTING_GRID
}

pub fn route_around_obstacles(
    request: &ObstacleRouteRequest,
) -> Result<ObstacleRouteResult, RoutingError> {
    validate_obstacle_request(request)?;
    let source_candidates = endpoint_candidates(
        &request.source_candidates,
        request.definition.source,
        request.definition.source_side,
        request.source_side_constraint,
    );
    let target_candidates = endpoint_candidates(
        &request.target_candidates,
        request.definition.target,
        request.definition.target_side,
        request.target_side_constraint,
    );
    if source_candidates.is_empty() || target_candidates.is_empty() {
        return Err(RoutingError::InvalidEndpointCandidates);
    }

    if request.source_side_constraint.is_some() && request.target_side_constraint.is_some() {
        let candidate_pairs = progressive_candidate_pairs(&source_candidates, &target_candidates);
        let center_result = candidate_pairs
            .first()
            .and_then(|(source, target)| route_candidate_pair(request, source, target).ok());

        if let Some(mut best) = center_result {
            if !has_short_terminal_staircase(&best.route.points, request.grid_size) {
                return Ok(best);
            }

            for (source, target) in candidate_pairs.iter().skip(1) {
                let Ok(candidate) = route_candidate_pair(request, source, target) else {
                    continue;
                };
                if attachment_route_is_better(request, &best, &candidate) {
                    best = candidate;
                }
            }

            return Ok(best);
        }

        for (source, target) in candidate_pairs.iter().skip(1) {
            if let Ok(result) = route_candidate_pair(request, source, target) {
                return Ok(result);
            }
        }

        return perimeter_fallback_route(request, &candidate_pairs).ok_or(RoutingError::NoRoute);
    }

    let mut candidate_pairs = source_candidates
        .iter()
        .flat_map(|source| {
            target_candidates.iter().map(move |target| {
                (
                    endpoint_pair_outward_penalty(request, source.side, target.side),
                    source,
                    target,
                )
            })
        })
        .collect::<Vec<_>>();
    candidate_pairs.sort_by(|first, second| {
        first
            .0
            .total_cmp(&second.0)
            .then_with(|| {
                manhattan(first.1.point, first.2.point)
                    .total_cmp(&manhattan(second.1.point, second.2.point))
            })
            .then_with(|| side_rank(first.1.side).cmp(&side_rank(second.1.side)))
            .then_with(|| side_rank(first.2.side).cmp(&side_rank(second.2.side)))
    });

    let mut pair_index = 0;
    while pair_index < candidate_pairs.len() {
        let group_penalty = candidate_pairs[pair_index].0;
        let mut best: Option<(RoutePairScore, ObstacleRouteResult)> = None;
        while pair_index < candidate_pairs.len()
            && candidate_pairs[pair_index]
                .0
                .total_cmp(&group_penalty)
                .is_eq()
        {
            let (_, source, target) = candidate_pairs[pair_index];
            pair_index += 1;
            let Ok(result) = route_candidate_pair(request, source, target) else {
                continue;
            };
            let score = route_pair_score(request, &result);
            if best
                .as_ref()
                .is_none_or(|(best_score, _)| compare_route_pair_score(score, *best_score).is_lt())
            {
                best = Some((score, result));
            }
        }
        // Outward penalty is the first route-pair score. Once any route succeeds
        // in the best viable group, no later group can outrank it.
        if let Some((_, result)) = best {
            return Ok(result);
        }
    }

    let fallback_pairs = source_candidates
        .iter()
        .flat_map(|source| target_candidates.iter().map(move |target| (source, target)))
        .collect::<Vec<_>>();
    perimeter_fallback_route(request, &fallback_pairs).ok_or(RoutingError::NoRoute)
}

fn route_candidate_pair(
    request: &ObstacleRouteRequest,
    source: &RouteEndpointCandidate,
    target: &RouteEndpointCandidate,
) -> Result<ObstacleRouteResult, RoutingError> {
    let mut pair_request = request.clone();
    pair_request.definition.source = source.point;
    pair_request.definition.source_side = source.side;
    pair_request.definition.target = target.point;
    pair_request.definition.target_side = target.side;
    pair_request.source_candidates.clear();
    pair_request.target_candidates.clear();
    pair_request.source_side_constraint = None;
    pair_request.target_side_constraint = None;
    let repaired_bend_points = canonicalize_terminal_bends(&pair_request);
    if let Some(bend_points) = &repaired_bend_points {
        pair_request.definition.manual_bends.clone_from(bend_points);
    }
    let mut result = route_single_pair(&pair_request)?;
    if let Some(bend_points) = repaired_bend_points {
        result.repaired_bend_points = Some(bend_points);
        result.repair_reason = Some(RouteRepairReason::TerminalOverlap);
    }
    Ok(result)
}

fn canonicalize_terminal_bends(request: &ObstacleRouteRequest) -> Option<Vec<Point>> {
    let bends = &request.definition.manual_bends;
    if bends.is_empty() {
        return None;
    }

    let mut canonical = bends.clone();
    let first_next = bends.get(1).copied().unwrap_or(request.definition.target);
    canonicalize_source_terminal(
        request.definition.source,
        request.definition.source_side,
        &mut canonical[0],
        first_next,
    );

    let last_index = canonical.len() - 1;
    let last_previous = if last_index > 0 {
        canonical[last_index - 1]
    } else {
        request.definition.source
    };
    canonicalize_target_terminal(
        request.definition.target,
        request.definition.target_side,
        last_previous,
        &mut canonical[last_index],
    );

    (canonical != *bends).then_some(canonical)
}

fn value_between(value: f64, first: f64, second: f64) -> bool {
    value >= first.min(second) && value <= first.max(second)
}

fn canonicalize_source_terminal(source: Point, side: Side, first: &mut Point, next: Point) {
    match side {
        Side::Left | Side::Right
            if first.x == next.x
                && source.y != first.y
                && value_between(source.y, first.y, next.y) =>
        {
            let outward = match side {
                Side::Left => first.x < source.x,
                Side::Right => first.x > source.x,
                _ => unreachable!(),
            };
            if outward {
                first.y = source.y;
            }
        }
        Side::Top | Side::Bottom
            if first.y == next.y
                && source.x != first.x
                && value_between(source.x, first.x, next.x) =>
        {
            let outward = match side {
                Side::Top => first.y < source.y,
                Side::Bottom => first.y > source.y,
                _ => unreachable!(),
            };
            if outward {
                first.x = source.x;
            }
        }
        _ => {}
    }
}

fn canonicalize_target_terminal(target: Point, side: Side, previous: Point, last: &mut Point) {
    match side {
        Side::Left | Side::Right
            if previous.x == last.x
                && target.y != last.y
                && value_between(target.y, previous.y, last.y) =>
        {
            let outward = match side {
                Side::Left => last.x < target.x,
                Side::Right => last.x > target.x,
                _ => unreachable!(),
            };
            if outward {
                last.y = target.y;
            }
        }
        Side::Top | Side::Bottom
            if previous.y == last.y
                && target.x != last.x
                && value_between(target.x, previous.x, last.x) =>
        {
            let outward = match side {
                Side::Top => last.y < target.y,
                Side::Bottom => last.y > target.y,
                _ => unreachable!(),
            };
            if outward {
                last.x = target.x;
            }
        }
        _ => {}
    }
}

fn facing_endpoint_corridor_route(
    request: &ObstacleRouteRequest,
    obstacles: &[RouteObstacle],
) -> Option<Vec<Point>> {
    if !request.definition.manual_bends.is_empty() {
        return None;
    }

    let source_bounds = obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.source_item_id)?
        .bounds;
    let target_bounds = obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.target_item_id)?
        .bounds;
    let source = request.definition.source;
    let target = request.definition.target;

    let (gap_start, gap_end, vertical) = match (
        request.definition.source_side,
        request.definition.target_side,
    ) {
        (Side::Top, Side::Bottom) if target_bounds.bottom() <= source_bounds.y => {
            (target_bounds.bottom(), source_bounds.y, true)
        }
        (Side::Bottom, Side::Top) if source_bounds.bottom() <= target_bounds.y => {
            (source_bounds.bottom(), target_bounds.y, true)
        }
        (Side::Left, Side::Right) if target_bounds.right() <= source_bounds.x => {
            (target_bounds.right(), source_bounds.x, false)
        }
        (Side::Right, Side::Left) if source_bounds.right() <= target_bounds.x => {
            (source_bounds.right(), target_bounds.x, false)
        }
        _ => return None,
    };

    let midpoint = (gap_start + gap_end) / 2.0;
    let mut corridor_coordinates = if request.snap_to_grid {
        vec![
            snap_if(midpoint, request),
            snap_after_if(gap_start, request),
            snap_before_if(gap_end, request),
        ]
    } else {
        vec![midpoint]
    };
    corridor_coordinates.retain(|coordinate| *coordinate >= gap_start && *coordinate <= gap_end);
    corridor_coordinates.sort_by(|first, second| {
        (first - midpoint)
            .abs()
            .total_cmp(&(second - midpoint).abs())
            .then_with(|| first.total_cmp(second))
    });
    corridor_coordinates.dedup_by(|first, second| first.to_bits() == second.to_bits());

    corridor_coordinates.into_iter().find_map(|coordinate| {
        let points = simplify_unprotected(if vertical {
            vec![
                source,
                Point {
                    x: source.x,
                    y: coordinate,
                },
                Point {
                    x: target.x,
                    y: coordinate,
                },
                target,
            ]
        } else {
            vec![
                source,
                Point {
                    x: coordinate,
                    y: source.y,
                },
                Point {
                    x: coordinate,
                    y: target.y,
                },
                target,
            ]
        });

        (route_structure_valid(&points, &request.definition)
            && !route_intersects_obstacles(
                &points,
                obstacles,
                &request.source_item_id,
                &request.target_item_id,
            )
            && reserved_overlap_distance(&points, request) == 0.0)
            .then_some(points)
    })
}

fn progressive_candidate_pairs<'a>(
    source_candidates: &'a [RouteEndpointCandidate],
    target_candidates: &'a [RouteEndpointCandidate],
) -> Vec<(&'a RouteEndpointCandidate, &'a RouteEndpointCandidate)> {
    let mut indexes = Vec::new();
    let mut seen = BTreeSet::new();
    let mut push = |source_index: usize, target_index: usize| {
        if source_index < source_candidates.len()
            && target_index < target_candidates.len()
            && seen.insert((source_index, target_index))
        {
            indexes.push((source_index, target_index));
        }
    };

    push(0, 0);
    let alternative_count = source_candidates.len().max(target_candidates.len());
    for index in 1..alternative_count {
        push(index, 0);
        push(0, index);
        push(index, index);
    }

    indexes
        .into_iter()
        .map(|(source_index, target_index)| {
            (
                &source_candidates[source_index],
                &target_candidates[target_index],
            )
        })
        .collect()
}

fn has_short_terminal_staircase(points: &[Point], grid_size: f64) -> bool {
    if points.len() < 4 {
        return false;
    }

    terminal_staircase([points[0], points[1], points[2], points[3]], grid_size)
        || terminal_staircase(
            [
                points[points.len() - 1],
                points[points.len() - 2],
                points[points.len() - 3],
                points[points.len() - 4],
            ],
            grid_size,
        )
}

fn terminal_staircase(points: [Point; 4], grid_size: f64) -> bool {
    let Some(first) = orientation(points[0], points[1]) else {
        return false;
    };
    let Some(middle) = orientation(points[1], points[2]) else {
        return false;
    };
    let Some(last) = orientation(points[2], points[3]) else {
        return false;
    };

    first == last
        && first != middle
        && manhattan(points[1], points[2]) <= grid_size.max(DEFAULT_ROUTING_GRID) * 2.0
}

fn attachment_route_is_better(
    request: &ObstacleRouteRequest,
    current: &ObstacleRouteResult,
    candidate: &ObstacleRouteResult,
) -> bool {
    candidate.route.points.len() < current.route.points.len()
        && reserved_overlap_distance(&candidate.route.points, request)
            <= reserved_overlap_distance(&current.route.points, request)
}

fn endpoint_pair_outward_penalty(
    request: &ObstacleRouteRequest,
    source_side: Side,
    target_side: Side,
) -> f64 {
    let source_bounds = request
        .obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.source_item_id)
        .map(|obstacle| obstacle.bounds);
    let target_bounds = request
        .obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.target_item_id)
        .map(|obstacle| obstacle.bounds);
    match (source_bounds, target_bounds) {
        (Some(source), Some(target)) => {
            outward_side_penalty(source_side, source, target)
                + outward_side_penalty(target_side, target, source)
        }
        _ => 0.0,
    }
}

fn perimeter_fallback_route(
    request: &ObstacleRouteRequest,
    candidate_pairs: &[(&RouteEndpointCandidate, &RouteEndpointCandidate)],
) -> Option<ObstacleRouteResult> {
    if !request.definition.manual_bends.is_empty() {
        return None;
    }

    let routing_obstacles = expanded_routing_obstacles(&request.obstacles);
    let route_coordinates = candidate_pairs
        .iter()
        .flat_map(|(source, target)| [source.point, target.point])
        .chain(routing_obstacles.iter().flat_map(|obstacle| {
            let bounds = obstacle.bounds;
            [
                Point {
                    x: bounds.x,
                    y: bounds.y,
                },
                Point {
                    x: bounds.right(),
                    y: bounds.bottom(),
                },
            ]
        }))
        .collect::<Vec<_>>();
    let margin = MIN_ROUTING_MARGIN.max(request.definition.lane_offset * 3.0);
    let bounds = search_bounds_with_margin(&route_coordinates, margin);
    let source_obstacle = routing_obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.source_item_id);
    let target_obstacle = routing_obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.target_item_id);
    let mut best: Option<(RoutePairScore, ObstacleRouteResult)> = None;

    for (source, target) in candidate_pairs {
        let mut pair_request = request.clone();
        pair_request.definition.source = source.point;
        pair_request.definition.source_side = source.side;
        pair_request.definition.target = target.point;
        pair_request.definition.target_side = target.side;
        let source_exit = obstacle_portal(
            source.point,
            source.side,
            source_obstacle,
            &pair_request,
            &routing_obstacles,
        );
        let target_entry = obstacle_portal(
            target.point,
            target.side,
            target_obstacle,
            &pair_request,
            &routing_obstacles,
        );
        let source_boundary = perimeter_point(source_exit, source.side, bounds);
        let target_boundary = perimeter_point(target_entry, target.side, bounds);

        if !segment_clear(source_exit, source_boundary, &routing_obstacles)
            || !segment_clear(target_entry, target_boundary, &routing_obstacles)
        {
            continue;
        }

        for perimeter in perimeter_paths(
            source_boundary,
            source.side,
            target_boundary,
            target.side,
            bounds,
        ) {
            let points = simplify_unprotected(
                std::iter::once(source.point)
                    .chain(std::iter::once(source_exit))
                    .chain(perimeter)
                    .chain(std::iter::once(target_entry))
                    .chain(std::iter::once(target.point))
                    .collect(),
            );
            if !route_structure_valid(&points, &pair_request.definition)
                || route_intersects_obstacles(
                    &points,
                    &routing_obstacles,
                    &request.source_item_id,
                    &request.target_item_id,
                )
            {
                continue;
            }

            let result = ObstacleRouteResult {
                route: RoutedPath {
                    connection_id: request.definition.connection_id,
                    points,
                    manual_anchor_point_indexes: Vec::new(),
                },
                source_side: source.side,
                target_side: target.side,
                used_fallback: true,
                warning: Some(RouteWarning::SearchExhausted),
                repaired_bend_points: None,
                repair_reason: None,
            };
            let score = route_pair_score(request, &result);
            if best
                .as_ref()
                .is_none_or(|(best_score, _)| compare_route_pair_score(score, *best_score).is_lt())
            {
                best = Some((score, result));
            }
        }
    }

    best.map(|(_, result)| result)
}

fn perimeter_point(point: Point, side: Side, bounds: SearchBounds) -> Point {
    match side {
        Side::Top => Point {
            x: point.x,
            y: bounds.top,
        },
        Side::Right => Point {
            x: bounds.right,
            y: point.y,
        },
        Side::Bottom => Point {
            x: point.x,
            y: bounds.bottom,
        },
        Side::Left => Point {
            x: bounds.left,
            y: point.y,
        },
    }
}

fn clockwise_corner(side: Side, bounds: SearchBounds) -> Point {
    match side {
        Side::Top => Point {
            x: bounds.right,
            y: bounds.top,
        },
        Side::Right => Point {
            x: bounds.right,
            y: bounds.bottom,
        },
        Side::Bottom => Point {
            x: bounds.left,
            y: bounds.bottom,
        },
        Side::Left => Point {
            x: bounds.left,
            y: bounds.top,
        },
    }
}

fn counterclockwise_corner(side: Side, bounds: SearchBounds) -> Point {
    match side {
        Side::Top => Point {
            x: bounds.left,
            y: bounds.top,
        },
        Side::Left => Point {
            x: bounds.left,
            y: bounds.bottom,
        },
        Side::Bottom => Point {
            x: bounds.right,
            y: bounds.bottom,
        },
        Side::Right => Point {
            x: bounds.right,
            y: bounds.top,
        },
    }
}

const fn clockwise_side(side: Side) -> Side {
    match side {
        Side::Top => Side::Right,
        Side::Right => Side::Bottom,
        Side::Bottom => Side::Left,
        Side::Left => Side::Top,
    }
}

const fn counterclockwise_side(side: Side) -> Side {
    match side {
        Side::Top => Side::Left,
        Side::Left => Side::Bottom,
        Side::Bottom => Side::Right,
        Side::Right => Side::Top,
    }
}

fn perimeter_paths(
    source: Point,
    source_side: Side,
    target: Point,
    target_side: Side,
    bounds: SearchBounds,
) -> [Vec<Point>; 2] {
    let mut clockwise = vec![source];
    let mut side = source_side;
    while side != target_side {
        clockwise.push(clockwise_corner(side, bounds));
        side = clockwise_side(side);
    }
    clockwise.push(target);

    let mut counterclockwise = vec![source];
    let mut side = source_side;
    while side != target_side {
        counterclockwise.push(counterclockwise_corner(side, bounds));
        side = counterclockwise_side(side);
    }
    counterclockwise.push(target);

    [clockwise, counterclockwise]
}

fn route_single_pair(request: &ObstacleRouteRequest) -> Result<ObstacleRouteResult, RoutingError> {
    let source_obstacle = request
        .obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.source_item_id);
    let target_obstacle = request
        .obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.target_item_id);
    let routing_obstacles = expanded_routing_obstacles(&request.obstacles);
    if let Some(points) = facing_endpoint_corridor_route(request, &routing_obstacles) {
        return Ok(ObstacleRouteResult {
            route: RoutedPath {
                connection_id: request.definition.connection_id,
                points,
                manual_anchor_point_indexes: Vec::new(),
            },
            source_side: request.definition.source_side,
            target_side: request.definition.target_side,
            used_fallback: false,
            warning: None,
            repaired_bend_points: None,
            repair_reason: None,
        });
    }
    let source_exit = obstacle_portal(
        request.definition.source,
        request.definition.source_side,
        source_obstacle,
        request,
        &routing_obstacles,
    );
    let target_entry = obstacle_portal(
        request.definition.target,
        request.definition.target_side,
        target_obstacle,
        request,
        &routing_obstacles,
    );
    if request.definition.manual_bends.is_empty()
        && let Some(points) =
            fast_orthogonal_route(request, source_exit, target_entry, &routing_obstacles)
    {
        return Ok(ObstacleRouteResult {
            route: RoutedPath {
                connection_id: request.definition.connection_id,
                points,
                manual_anchor_point_indexes: Vec::new(),
            },
            source_side: request.definition.source_side,
            target_side: request.definition.target_side,
            used_fallback: false,
            warning: None,
            repaired_bend_points: None,
            repair_reason: None,
        });
    }
    let route_coordinates = std::iter::once(request.definition.source)
        .chain(std::iter::once(request.definition.target))
        .chain(std::iter::once(source_exit))
        .chain(std::iter::once(target_entry))
        .chain(request.definition.manual_bends.iter().copied())
        .collect::<Vec<_>>();
    for bounds in adaptive_search_bounds(
        &route_coordinates,
        request.definition.lane_offset,
        &routing_obstacles,
    ) {
        let obstacles = routing_obstacles
            .iter()
            .filter(|obstacle| bounds.intersects(obstacle.bounds))
            .cloned()
            .collect::<Vec<_>>();
        let anchors = request
            .definition
            .manual_bends
            .iter()
            .map(|anchor| resolve_covered_anchor(*anchor, &obstacles, request))
            .collect::<Vec<_>>();
        let shortest_path = find_visibility_path(
            source_exit,
            target_entry,
            &anchors,
            &obstacles,
            &[],
            request,
            bounds,
        );
        let overlap_aware_path = find_visibility_path(
            source_exit,
            target_entry,
            &anchors,
            &obstacles,
            &request.reserved_segments,
            request,
            bounds,
        );
        let Some(graph_path) =
            choose_bounded_overlap_route(shortest_path, overlap_aware_path, request.grid_size)
        else {
            continue;
        };

        // Portal points guide the search but do not carry user intent. Once a safe
        // route exists, only explicit manual anchors need to survive collinear
        // simplification.
        let points = simplify_protected(
            std::iter::once(request.definition.source)
                .chain(graph_path)
                .chain(std::iter::once(request.definition.target))
                .collect(),
            &anchors,
        );
        if !route_structure_valid(&points, &request.definition)
            || route_intersects_obstacles(
                &points,
                &obstacles,
                &request.source_item_id,
                &request.target_item_id,
            )
        {
            continue;
        }

        let mut search_from = 0;
        let mut manual_anchor_point_indexes = Vec::with_capacity(anchors.len());
        let mut anchors_resolved = true;
        for anchor in anchors {
            let Some(index) = points
                .iter()
                .enumerate()
                .skip(search_from)
                .find_map(|(index, point)| points_equal(*point, anchor).then_some(index))
            else {
                anchors_resolved = false;
                break;
            };
            manual_anchor_point_indexes
                .push(u16::try_from(index).map_err(|_| RoutingError::InvalidSegmentIndex)?);
            search_from = index + 1;
        }
        if !anchors_resolved {
            continue;
        }

        return Ok(ObstacleRouteResult {
            route: RoutedPath {
                connection_id: request.definition.connection_id,
                points,
                manual_anchor_point_indexes,
            },
            source_side: request.definition.source_side,
            target_side: request.definition.target_side,
            used_fallback: false,
            warning: None,
            repaired_bend_points: None,
            repair_reason: None,
        });
    }

    fallback_route(request)
}

fn fast_orthogonal_route(
    request: &ObstacleRouteRequest,
    source_exit: Point,
    target_entry: Point,
    obstacles: &[RouteObstacle],
) -> Option<Vec<Point>> {
    let mut interiors = Vec::<Vec<Point>>::new();
    if source_exit.x == target_entry.x || source_exit.y == target_entry.y {
        interiors.push(Vec::new());
    }
    interiors.push(vec![Point {
        x: source_exit.x,
        y: target_entry.y,
    }]);
    interiors.push(vec![Point {
        x: target_entry.x,
        y: source_exit.y,
    }]);

    interiors
        .into_iter()
        .filter_map(|interior| {
            let points = simplify_unprotected(
                std::iter::once(request.definition.source)
                    .chain(std::iter::once(source_exit))
                    .chain(interior)
                    .chain(std::iter::once(target_entry))
                    .chain(std::iter::once(request.definition.target))
                    .collect(),
            );
            if !route_structure_valid(&points, &request.definition)
                || route_intersects_obstacles(
                    &points,
                    obstacles,
                    &request.source_item_id,
                    &request.target_item_id,
                )
                || reserved_overlap_distance(&points, request) > 0.0
            {
                return None;
            }
            Some(points)
        })
        .min_by(|first, second| {
            route_distance(first)
                .total_cmp(&route_distance(second))
                .then_with(|| first.len().cmp(&second.len()))
        })
}

fn route_distance(points: &[Point]) -> f64 {
    points
        .windows(2)
        .map(|pair| manhattan(pair[0], pair[1]))
        .sum()
}

fn reserved_overlap_distance(points: &[Point], request: &ObstacleRouteRequest) -> f64 {
    reservable_segments(points)
        .iter()
        .flat_map(|segment| {
            request.reserved_segments.iter().map(move |reserved| {
                collinear_conflict_length(*segment, *reserved, request.grid_size)
            })
        })
        .sum()
}

fn endpoint_candidates(
    candidates: &[RouteEndpointCandidate],
    fallback_point: Point,
    fallback_side: Side,
    constraint: Option<Side>,
) -> Vec<RouteEndpointCandidate> {
    let candidates = if candidates.is_empty() {
        vec![RouteEndpointCandidate {
            point: fallback_point,
            side: fallback_side,
        }]
    } else {
        candidates.to_vec()
    };
    candidates
        .into_iter()
        .filter(|candidate| constraint.is_none_or(|side| side == candidate.side))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct RoutePairScore {
    overlap_distance: f64,
    outward_penalty: f64,
    distance: f64,
    bends: usize,
    previous_pair_penalty: u8,
    source_side_rank: u8,
    target_side_rank: u8,
}

fn route_pair_score(
    request: &ObstacleRouteRequest,
    result: &ObstacleRouteResult,
) -> RoutePairScore {
    let overlap_distance = reserved_overlap_distance(&result.route.points, request);
    let source_bounds = request
        .obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.source_item_id)
        .map(|obstacle| obstacle.bounds);
    let target_bounds = request
        .obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.target_item_id)
        .map(|obstacle| obstacle.bounds);
    let outward_penalty = match (source_bounds, target_bounds) {
        (Some(source), Some(target)) => {
            outward_side_penalty(result.source_side, source, target)
                + outward_side_penalty(result.target_side, target, source)
        }
        _ => 0.0,
    };
    RoutePairScore {
        overlap_distance,
        outward_penalty,
        distance: result
            .route
            .points
            .windows(2)
            .map(|pair| manhattan(pair[0], pair[1]))
            .sum(),
        bends: result.route.points.len().saturating_sub(2),
        previous_pair_penalty: u8::from(
            request.previous_source_side != Some(result.source_side)
                || request.previous_target_side != Some(result.target_side),
        ),
        source_side_rank: side_rank(result.source_side),
        target_side_rank: side_rank(result.target_side),
    }
}

fn compare_route_pair_score(first: RoutePairScore, second: RoutePairScore) -> Ordering {
    first
        .outward_penalty
        .total_cmp(&second.outward_penalty)
        .then_with(|| first.distance.total_cmp(&second.distance))
        .then_with(|| first.bends.cmp(&second.bends))
        .then_with(|| first.overlap_distance.total_cmp(&second.overlap_distance))
        .then_with(|| {
            first
                .previous_pair_penalty
                .cmp(&second.previous_pair_penalty)
        })
        .then_with(|| first.source_side_rank.cmp(&second.source_side_rank))
        .then_with(|| first.target_side_rank.cmp(&second.target_side_rank))
}

fn outward_side_penalty(side: Side, source: Rect, target: Rect) -> f64 {
    let source_center = Point {
        x: source.x + source.width / 2.0,
        y: source.y + source.height / 2.0,
    };
    let target_center = Point {
        x: target.x + target.width / 2.0,
        y: target.y + target.height / 2.0,
    };
    let dx = target_center.x - source_center.x;
    let dy = target_center.y - source_center.y;
    let magnitude = dx.abs() + dy.abs();
    if magnitude == 0.0 {
        return 0.0;
    }
    let alignment = match side {
        Side::Left => -dx,
        Side::Right => dx,
        Side::Top => -dy,
        Side::Bottom => dy,
    } / magnitude;
    1.0 - alignment
}

const fn side_rank(side: Side) -> u8 {
    match side {
        Side::Top => 0,
        Side::Right => 1,
        Side::Bottom => 2,
        Side::Left => 3,
    }
}

fn validate_obstacle_request(request: &ObstacleRouteRequest) -> Result<(), RoutingError> {
    validate_obstacle_request_base(request)?;
    validate_obstacles(&request.obstacles)
}

fn validate_obstacle_request_base(request: &ObstacleRouteRequest) -> Result<(), RoutingError> {
    request.definition.validate()?;
    validate_endpoint_candidates(&request.source_candidates)?;
    validate_endpoint_candidates(&request.target_candidates)?;
    if request.source_item_id.trim().is_empty() || request.target_item_id.trim().is_empty() {
        return Err(RoutingError::EmptyItemId);
    }
    validate_optional_grid(request.snap_to_grid.then_some(request.grid_size))?;
    for segment in &request.reserved_segments {
        Segment {
            start: segment.start,
            end: segment.end,
        }
        .validate()?;
    }
    if let Some(previous) = &request.previous_valid_route {
        if previous.connection_id != request.definition.connection_id {
            return Err(RoutingError::InvalidConnectionId);
        }
        for pair in previous.points.windows(2) {
            Segment {
                start: pair[0],
                end: pair[1],
            }
            .validate()?;
        }
    }
    Ok(())
}

fn validate_endpoint_candidates(candidates: &[RouteEndpointCandidate]) -> Result<(), RoutingError> {
    let mut points = BTreeSet::new();
    for candidate in candidates {
        candidate.point.validate()?;
        if !points.insert((
            side_rank(candidate.side),
            candidate.point.x.to_bits(),
            candidate.point.y.to_bits(),
        )) {
            return Err(RoutingError::InvalidEndpointCandidates);
        }
    }
    Ok(())
}

fn validate_obstacles(obstacles: &[RouteObstacle]) -> Result<(), RoutingError> {
    let mut ids = obstacles
        .iter()
        .map(|obstacle| obstacle.item_id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    if ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(RoutingError::DuplicateObstacleId);
    }
    for obstacle in obstacles {
        if obstacle.item_id.trim().is_empty() {
            return Err(RoutingError::EmptyItemId);
        }
        obstacle.bounds.validate()?;
    }
    Ok(())
}

fn changed_obstacle_bounds(
    previous: &[RouteObstacle],
    next: &[RouteObstacle],
) -> Vec<(String, Rect)> {
    let previous_by_id = previous
        .iter()
        .map(|obstacle| (obstacle.item_id.as_str(), obstacle.bounds))
        .collect::<BTreeMap<_, _>>();
    let next_by_id = next
        .iter()
        .map(|obstacle| (obstacle.item_id.as_str(), obstacle.bounds))
        .collect::<BTreeMap<_, _>>();
    let ids = previous_by_id
        .keys()
        .chain(next_by_id.keys())
        .copied()
        .collect::<BTreeSet<_>>();
    let mut changed = Vec::new();
    for item_id in ids {
        let previous_bounds = previous_by_id.get(item_id).copied();
        let next_bounds = next_by_id.get(item_id).copied();
        if previous_bounds == next_bounds {
            continue;
        }
        if let Some(bounds) = previous_bounds {
            changed.push((item_id.to_owned(), bounds));
        }
        if let Some(bounds) = next_bounds {
            changed.push((item_id.to_owned(), bounds));
        }
    }
    changed
}

fn route_near_rect(points: &[Point], rect: Rect) -> bool {
    let clearance = DEFAULT_ROUTING_GRID;
    let left = rect.x - clearance;
    let right = rect.right() + clearance;
    let top = rect.y - clearance;
    let bottom = rect.bottom() + clearance;
    points.windows(2).any(|pair| {
        let segment_left = pair[0].x.min(pair[1].x);
        let segment_right = pair[0].x.max(pair[1].x);
        let segment_top = pair[0].y.min(pair[1].y);
        let segment_bottom = pair[0].y.max(pair[1].y);
        segment_right >= left
            && segment_left <= right
            && segment_bottom >= top
            && segment_top <= bottom
    })
}

fn fallback_route(request: &ObstacleRouteRequest) -> Result<ObstacleRouteResult, RoutingError> {
    let route = request
        .previous_valid_route
        .clone()
        .filter(|route| route_safe_for_request(route, request))
        .or_else(|| {
            build_route(&request.definition)
                .ok()
                .filter(|route| route_safe_for_request(route, request))
        })
        .ok_or(RoutingError::NoRoute)?;
    Ok(ObstacleRouteResult {
        route,
        source_side: request.definition.source_side,
        target_side: request.definition.target_side,
        used_fallback: true,
        warning: Some(RouteWarning::SearchExhausted),
        repaired_bend_points: None,
        repair_reason: None,
    })
}

fn selected_definition(
    request: &ObstacleRouteRequest,
    result: &ObstacleRouteResult,
) -> Option<RouteDefinition> {
    let source_point = result.route.points.first().copied()?;
    let target_point = result.route.points.last().copied()?;
    let source_candidates = endpoint_candidates(
        &request.source_candidates,
        request.definition.source,
        request.definition.source_side,
        request.source_side_constraint,
    );
    let target_candidates = endpoint_candidates(
        &request.target_candidates,
        request.definition.target,
        request.definition.target_side,
        request.target_side_constraint,
    );
    let source = source_candidates.iter().find(|candidate| {
        candidate.side == result.source_side && points_equal(candidate.point, source_point)
    })?;
    let target = target_candidates.iter().find(|candidate| {
        candidate.side == result.target_side && points_equal(candidate.point, target_point)
    })?;
    let mut definition = request.definition.clone();
    definition.source_side = source.side;
    definition.target_side = target.side;
    definition.source = source.point;
    definition.target = target.point;
    Some(definition)
}

fn route_safe_for_request(route: &RoutedPath, request: &ObstacleRouteRequest) -> bool {
    route_structure_valid(&route.points, &request.definition)
        && !route_intersects_equipment_clearance(
            &route.points,
            &request.obstacles,
            &request.source_item_id,
            &request.target_item_id,
        )
}

fn route_safe_for_result(result: &ObstacleRouteResult, request: &ObstacleRouteRequest) -> bool {
    let mut selected_request = request.clone();
    let Some(definition) = selected_definition(request, result) else {
        return false;
    };
    selected_request.definition = definition;
    route_safe_for_request(&result.route, &selected_request)
}

fn expanded_routing_obstacles(obstacles: &[RouteObstacle]) -> Vec<RouteObstacle> {
    obstacles
        .iter()
        .map(|obstacle| RouteObstacle {
            item_id: obstacle.item_id.clone(),
            bounds: Rect {
                x: obstacle.bounds.x - EQUIPMENT_ROUTE_CLEARANCE,
                y: obstacle.bounds.y - EQUIPMENT_ROUTE_CLEARANCE,
                width: obstacle.bounds.width + EQUIPMENT_ROUTE_CLEARANCE * 2.0,
                height: obstacle.bounds.height + EQUIPMENT_ROUTE_CLEARANCE * 2.0,
            },
        })
        .collect()
}

fn route_intersects_equipment_clearance(
    points: &[Point],
    obstacles: &[RouteObstacle],
    source_item_id: &str,
    target_item_id: &str,
) -> bool {
    route_intersects_obstacles(
        points,
        &expanded_routing_obstacles(obstacles),
        source_item_id,
        target_item_id,
    )
}

fn search_bounds_with_margin(points: &[Point], margin: f64) -> SearchBounds {
    SearchBounds {
        left: points
            .iter()
            .map(|point| point.x)
            .fold(f64::INFINITY, f64::min)
            - margin,
        top: points
            .iter()
            .map(|point| point.y)
            .fold(f64::INFINITY, f64::min)
            - margin,
        right: points
            .iter()
            .map(|point| point.x)
            .fold(f64::NEG_INFINITY, f64::max)
            + margin,
        bottom: points
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, f64::max)
            + margin,
    }
}

fn adaptive_search_bounds(
    points: &[Point],
    lane_offset: f64,
    obstacles: &[RouteObstacle],
) -> Vec<SearchBounds> {
    let base = MIN_ROUTING_MARGIN.max(lane_offset * 3.0);
    let mut attempts = vec![
        search_bounds_with_margin(points, base),
        search_bounds_with_margin(points, base * 2.0),
        search_bounds_with_margin(points, base * 4.0),
    ];
    if !obstacles.is_empty() {
        let all_points = points
            .iter()
            .copied()
            .chain(obstacles.iter().flat_map(|obstacle| {
                let bounds = obstacle.bounds;
                [
                    Point {
                        x: bounds.x,
                        y: bounds.y,
                    },
                    Point {
                        x: bounds.right(),
                        y: bounds.bottom(),
                    },
                ]
            }))
            .collect::<Vec<_>>();
        attempts.push(search_bounds_with_margin(&all_points, base));
    }
    attempts
}

fn obstacle_portal(
    point: Point,
    side: Side,
    obstacle: Option<&RouteObstacle>,
    request: &ObstacleRouteRequest,
    obstacles: &[RouteObstacle],
) -> Point {
    let Some(obstacle) = obstacle else {
        return safe_side_offset(
            point,
            side,
            request.definition.lane_offset,
            request.grid_size,
            obstacles,
        );
    };
    let bounds = obstacle.bounds;
    let preferred_clearance = request.definition.lane_offset.max(request.grid_size);
    let preferred = portal_at_clearance(point, side, bounds, preferred_clearance, request, true);
    let grid_clearance = preferred_clearance.min(request.grid_size);
    let grid = portal_at_clearance(point, side, bounds, grid_clearance, request, false);
    let boundary = portal_at_clearance(point, side, bounds, 0.0, request, false);

    [preferred, grid, boundary]
        .into_iter()
        .find(|candidate| {
            portal_candidate_clear(point, *candidate, side, &obstacle.item_id, obstacles)
        })
        .unwrap_or(boundary)
}

fn portal_at_clearance(
    point: Point,
    side: Side,
    bounds: Rect,
    clearance: f64,
    request: &ObstacleRouteRequest,
    snap_outward: bool,
) -> Point {
    let snap_before = |value| {
        if snap_outward {
            snap_before_if(value, request)
        } else {
            snap_if(value, request)
        }
    };
    let snap_after = |value| {
        if snap_outward {
            snap_after_if(value, request)
        } else {
            snap_if(value, request)
        }
    };
    match side {
        Side::Left => Point {
            x: snap_before(bounds.x - clearance),
            y: point.y,
        },
        Side::Right => Point {
            x: snap_after(bounds.right() + clearance),
            y: point.y,
        },
        Side::Top => Point {
            x: point.x,
            y: snap_before(bounds.y - clearance),
        },
        Side::Bottom => Point {
            x: point.x,
            y: snap_after(bounds.bottom() + clearance),
        },
    }
}

fn portal_candidate_clear(
    endpoint: Point,
    candidate: Point,
    side: Side,
    own_item_id: &str,
    obstacles: &[RouteObstacle],
) -> bool {
    moves_in_side(endpoint, candidate, side)
        && obstacles.iter().all(|obstacle| {
            if obstacle.item_id == own_item_id {
                return !point_inside_obstacle(candidate, obstacle.bounds);
            }
            !point_inside_obstacle(candidate, obstacle.bounds)
                && !segment_crosses_obstacle_interior(endpoint, candidate, obstacle.bounds)
        })
}

fn safe_side_offset(
    point: Point,
    side: Side,
    preferred_distance: f64,
    grid_size: f64,
    obstacles: &[RouteObstacle],
) -> Point {
    let mut distances = vec![preferred_distance, preferred_distance.min(grid_size), 0.0];
    distances.sort_by(|first, second| second.total_cmp(first));
    distances.dedup_by(|first, second| first == second);
    distances
        .into_iter()
        .map(|distance| side_offset(point, side, distance))
        .find(|candidate| {
            !point_inside_any_obstacle(*candidate, obstacles)
                && segment_clear(point, *candidate, obstacles)
        })
        .unwrap_or(point)
}

fn resolve_covered_anchor(
    anchor: Point,
    obstacles: &[RouteObstacle],
    request: &ObstacleRouteRequest,
) -> Point {
    if !point_inside_any_obstacle(anchor, obstacles) {
        return anchor;
    }
    let mut candidates = obstacles
        .iter()
        .filter(|obstacle| point_inside_obstacle(anchor, obstacle.bounds))
        .flat_map(|obstacle| {
            let left = snap_before_if(obstacle.bounds.x, request);
            let right = snap_after_if(obstacle.bounds.right(), request);
            let top = snap_before_if(obstacle.bounds.y, request);
            let bottom = snap_after_if(obstacle.bounds.bottom(), request);
            let anchor_x = snap_if(anchor.x, request);
            let anchor_y = snap_if(anchor.y, request);
            [
                Point {
                    x: left,
                    y: anchor_y,
                },
                Point {
                    x: right,
                    y: anchor_y,
                },
                Point {
                    x: anchor_x,
                    y: top,
                },
                Point {
                    x: anchor_x,
                    y: bottom,
                },
            ]
        })
        .filter(|candidate| !point_inside_any_obstacle(*candidate, obstacles))
        .collect::<Vec<_>>();
    candidates.sort_by(|first, second| {
        manhattan(*first, anchor)
            .total_cmp(&manhattan(*second, anchor))
            .then_with(|| first.x.total_cmp(&second.x))
            .then_with(|| first.y.total_cmp(&second.y))
    });
    candidates.first().copied().unwrap_or(anchor)
}

fn find_visibility_path(
    start: Point,
    end: Point,
    anchors: &[Point],
    obstacles: &[RouteObstacle],
    reserved_segments: &[ReservedSegment],
    request: &ObstacleRouteRequest,
    bounds: SearchBounds,
) -> Option<Vec<Point>> {
    let graph = build_visibility_graph(
        start,
        end,
        anchors,
        obstacles,
        reserved_segments,
        request,
        bounds,
    );
    let start_id = *graph.node_ids.get(&point_bits(start))?;
    let end_id = *graph.node_ids.get(&point_bits(end))?;
    let initial_direction = side_direction(request.definition.source_side);
    let final_direction = side_direction(request.definition.target_side);
    let initial_key = SearchKey {
        node_id: start_id,
        direction: initial_direction,
        phase: advance_phase(start, 0, anchors),
    };
    let initial_best = SearchBest {
        cost: SearchCost {
            distance: 0.0,
            bends: 0,
            overlap_distance: 0.0,
        },
        lexical_path: lexical_node(start_id),
    };
    let mut queue = BinaryHeap::new();
    queue.push(QueueEntry {
        key: initial_key,
        cost: initial_best.cost,
        lexical_path: initial_best.lexical_path.clone(),
    });
    let mut best = HashMap::from([(initial_key, initial_best)]);
    let mut previous = HashMap::<SearchKey, SearchKey>::new();
    let mut best_end: Option<(SearchKey, SearchBest)> = None;
    let mut visited_states = 0usize;

    while let Some(current) = queue.pop() {
        visited_states += 1;
        if visited_states > MAX_VISIBILITY_SEARCH_STATES {
            return None;
        }
        let Some(known) = best.get(&current.key) else {
            continue;
        };
        if known.cost != current.cost || known.lexical_path != current.lexical_path {
            continue;
        }
        if current.key.node_id == end_id && current.key.phase == anchors.len() {
            let mut final_best = known.clone();
            if current.key.direction != final_direction {
                final_best.cost.bends += 1;
            }
            if best_end
                .as_ref()
                .is_none_or(|(_, candidate)| compare_search_best(&final_best, candidate).is_lt())
            {
                best_end = Some((current.key, final_best));
            }
            continue;
        }

        for edge in &graph.edges[current.key.node_id] {
            let node = graph.nodes[edge.to];
            let current_node = graph.nodes[current.key.node_id];
            if current.key.node_id == start_id
                && moves_against_side(current_node, node, request.definition.source_side)
            {
                continue;
            }
            if edge.to == end_id
                && moves_in_side(current_node, node, request.definition.target_side)
            {
                continue;
            }
            let next_key = SearchKey {
                node_id: edge.to,
                direction: edge.direction,
                phase: advance_phase(node, current.key.phase, anchors),
            };
            let candidate = SearchBest {
                cost: SearchCost {
                    distance: current.cost.distance + edge.distance,
                    bends: current.cost.bends + u32::from(current.key.direction != edge.direction),
                    overlap_distance: current.cost.overlap_distance + edge.overlap_distance,
                },
                lexical_path: format!("{}:{:08}", current.lexical_path, edge.to),
            };
            if best
                .get(&next_key)
                .is_some_and(|known| !compare_search_best(&candidate, known).is_lt())
            {
                continue;
            }
            previous.insert(next_key, current.key);
            best.insert(next_key, candidate.clone());
            queue.push(QueueEntry {
                key: next_key,
                cost: candidate.cost,
                lexical_path: candidate.lexical_path,
            });
        }
    }

    let (mut key, _) = best_end?;
    let mut path = Vec::new();
    loop {
        path.push(graph.nodes[key.node_id]);
        let Some(parent) = previous.get(&key).copied() else {
            break;
        };
        key = parent;
    }
    path.reverse();
    Some(path)
}

fn choose_bounded_overlap_route(
    shortest_path: Option<Vec<Point>>,
    overlap_aware_path: Option<Vec<Point>>,
    grid_size: f64,
) -> Option<Vec<Point>> {
    let shortest_path = shortest_path.or(overlap_aware_path.clone())?;
    let Some(overlap_aware_path) = overlap_aware_path else {
        return Some(shortest_path);
    };
    let shortest_distance = path_distance(&shortest_path);
    let overlap_aware_distance = path_distance(&overlap_aware_path);
    let detour_budget = (shortest_distance * COLLISION_DETOUR_RATIO).clamp(
        grid_size * MIN_COLLISION_DETOUR_BUDGET_IN_GRIDS,
        grid_size * MAX_COLLISION_DETOUR_BUDGET_IN_GRIDS,
    );

    if overlap_aware_distance <= shortest_distance + detour_budget {
        Some(overlap_aware_path)
    } else {
        Some(shortest_path)
    }
}

fn path_distance(points: &[Point]) -> f64 {
    points
        .windows(2)
        .map(|pair| manhattan(pair[0], pair[1]))
        .sum()
}

fn build_visibility_graph(
    start: Point,
    end: Point,
    anchors: &[Point],
    obstacles: &[RouteObstacle],
    reserved_segments: &[ReservedSegment],
    request: &ObstacleRouteRequest,
    bounds: SearchBounds,
) -> VisibilityGraph {
    let (xs, ys) = coordinate_values(
        start,
        end,
        anchors,
        obstacles,
        reserved_segments,
        request,
        bounds,
    );
    let mut nodes = Vec::new();
    let mut node_ids = HashMap::new();
    for y in ys {
        for x in &xs {
            let point = Point { x: *x, y };
            if !bounds.contains(point) || point_inside_any_obstacle(point, obstacles) {
                continue;
            }
            let id = nodes.len();
            nodes.push(point);
            node_ids.insert(point_bits(point), id);
        }
    }
    let mut edges = vec![Vec::new(); nodes.len()];
    let mut rows = HashMap::<u64, Vec<usize>>::new();
    let mut columns = HashMap::<u64, Vec<usize>>::new();
    for (id, point) in nodes.iter().enumerate() {
        rows.entry(point.y.to_bits()).or_default().push(id);
        columns.entry(point.x.to_bits()).or_default().push(id);
    }
    for row in rows.values_mut() {
        row.sort_by(|first, second| nodes[*first].x.total_cmp(&nodes[*second].x));
        for pair in row.windows(2) {
            connect_graph_nodes(
                &nodes,
                &mut edges,
                pair[0],
                pair[1],
                SearchDirection::Horizontal,
                obstacles,
                reserved_segments,
                request.grid_size,
            );
        }
    }
    for column in columns.values_mut() {
        column.sort_by(|first, second| nodes[*first].y.total_cmp(&nodes[*second].y));
        for pair in column.windows(2) {
            connect_graph_nodes(
                &nodes,
                &mut edges,
                pair[0],
                pair[1],
                SearchDirection::Vertical,
                obstacles,
                reserved_segments,
                request.grid_size,
            );
        }
    }
    for node_edges in &mut edges {
        node_edges.sort_by(|first, second| {
            first.to.cmp(&second.to).then_with(|| {
                direction_rank(first.direction).cmp(&direction_rank(second.direction))
            })
        });
    }
    VisibilityGraph {
        nodes,
        edges,
        node_ids,
    }
}

#[allow(clippy::too_many_arguments)]
fn connect_graph_nodes(
    nodes: &[Point],
    edges: &mut [Vec<GraphEdge>],
    first_id: usize,
    second_id: usize,
    direction: SearchDirection,
    obstacles: &[RouteObstacle],
    reserved_segments: &[ReservedSegment],
    separation: f64,
) {
    let first = nodes[first_id];
    let second = nodes[second_id];
    if points_equal(first, second) || !segment_clear(first, second, obstacles) {
        return;
    }
    let candidate = ReservedSegment {
        start: first,
        end: second,
    };
    let overlap_distance = reserved_segments
        .iter()
        .map(|reserved| collinear_conflict_length(candidate, *reserved, separation))
        .sum();
    let edge = GraphEdge {
        to: second_id,
        direction,
        distance: manhattan(first, second),
        overlap_distance,
    };
    let inverse = GraphEdge {
        to: first_id,
        ..edge
    };
    edges[first_id].push(edge);
    edges[second_id].push(inverse);
}

fn coordinate_values(
    start: Point,
    end: Point,
    anchors: &[Point],
    obstacles: &[RouteObstacle],
    reserved_segments: &[ReservedSegment],
    request: &ObstacleRouteRequest,
    bounds: SearchBounds,
) -> (Vec<f64>, Vec<f64>) {
    let mut xs = vec![start.x, end.x, bounds.left, bounds.right];
    let mut ys = vec![start.y, end.y, bounds.top, bounds.bottom];
    for anchor in anchors {
        xs.push(anchor.x);
        ys.push(anchor.y);
    }
    for obstacle in obstacles {
        xs.extend([
            snap_before_if(obstacle.bounds.x, request),
            snap_after_if(obstacle.bounds.right(), request),
        ]);
        ys.extend([
            snap_before_if(obstacle.bounds.y, request),
            snap_after_if(obstacle.bounds.bottom(), request),
        ]);
    }
    for segment in reserved_segments {
        match orientation(segment.start, segment.end) {
            Some(Orientation::Horizontal) => {
                xs.extend([segment.start.x, segment.end.x]);
                ys.extend([
                    segment.start.y - request.grid_size,
                    segment.start.y + request.grid_size,
                ]);
            }
            Some(Orientation::Vertical) => {
                ys.extend([segment.start.y, segment.end.y]);
                xs.extend([
                    segment.start.x - request.grid_size,
                    segment.start.x + request.grid_size,
                ]);
            }
            None => {}
        }
    }
    xs.retain(|value| *value >= bounds.left && *value <= bounds.right);
    ys.retain(|value| *value >= bounds.top && *value <= bounds.bottom);
    sort_deduplicate(&mut xs);
    sort_deduplicate(&mut ys);
    (xs, ys)
}

fn simplify_protected(points: Vec<Point>, protected: &[Point]) -> Vec<Point> {
    let mut result = Vec::<Point>::with_capacity(points.len());
    for point in points {
        if result
            .last()
            .is_some_and(|previous| points_equal(*previous, point))
        {
            continue;
        }
        if result.len() >= 2 {
            let previous = result[result.len() - 1];
            let before = result[result.len() - 2];
            let previous_is_protected = protected
                .iter()
                .any(|protected_point| points_equal(previous, *protected_point));
            if !previous_is_protected
                && orientation(before, previous) == orientation(previous, point)
                && point_between(before, previous, point)
            {
                let previous_index = result.len() - 1;
                result[previous_index] = point;
                continue;
            }
        }
        result.push(point);
    }
    result
}

pub fn segment_crosses_obstacle_interior(first: Point, second: Point, obstacle: Rect) -> bool {
    if first.y == second.y {
        let left = first.x.min(second.x);
        let right = first.x.max(second.x);
        return first.y > obstacle.y
            && first.y < obstacle.bottom()
            && right > obstacle.x
            && left < obstacle.right();
    }
    if first.x == second.x {
        let top = first.y.min(second.y);
        let bottom = first.y.max(second.y);
        return first.x > obstacle.x
            && first.x < obstacle.right()
            && bottom > obstacle.y
            && top < obstacle.bottom();
    }
    true
}

pub fn segments_have_collinear_conflict(
    first: ReservedSegment,
    second: ReservedSegment,
    separation: f64,
) -> bool {
    collinear_conflict_length(first, second, separation) > 0.0
}

fn collinear_conflict_length(
    first: ReservedSegment,
    second: ReservedSegment,
    separation: f64,
) -> f64 {
    let first_orientation = orientation(first.start, first.end);
    let second_orientation = orientation(second.start, second.end);
    if first_orientation.is_none() || first_orientation != second_orientation {
        return 0.0;
    }
    match first_orientation {
        Some(Orientation::Horizontal) => {
            if (first.start.y - second.start.y).abs() >= separation {
                return 0.0;
            }
            overlap_length(first.start.x, first.end.x, second.start.x, second.end.x)
        }
        Some(Orientation::Vertical) => {
            if (first.start.x - second.start.x).abs() >= separation {
                return 0.0;
            }
            overlap_length(first.start.y, first.end.y, second.start.y, second.end.y)
        }
        None => 0.0,
    }
}

fn reservation_change_affects_route(
    route: ReservedSegment,
    changed: ReservedSegment,
    lane_spacing: f64,
) -> bool {
    let route_orientation = orientation(route.start, route.end);
    let changed_orientation = orientation(changed.start, changed.end);
    if route_orientation.is_none() || route_orientation != changed_orientation {
        return false;
    }
    match route_orientation {
        Some(Orientation::Horizontal) => {
            (route.start.y - changed.start.y).abs() <= lane_spacing
                && overlap_length(route.start.x, route.end.x, changed.start.x, changed.end.x) > 0.0
        }
        Some(Orientation::Vertical) => {
            (route.start.x - changed.start.x).abs() <= lane_spacing
                && overlap_length(route.start.y, route.end.y, changed.start.y, changed.end.y) > 0.0
        }
        None => false,
    }
}

fn overlap_length(first_start: f64, first_end: f64, second_start: f64, second_end: f64) -> f64 {
    let overlap_start = first_start.min(first_end).max(second_start.min(second_end));
    let overlap_end = first_start.max(first_end).min(second_start.max(second_end));
    (overlap_end - overlap_start).max(0.0)
}

pub fn reservable_segments(points: &[Point]) -> Vec<ReservedSegment> {
    let reserve_entire_route = points.len() <= 3;
    points
        .windows(2)
        .enumerate()
        .filter_map(|(index, pair)| {
            if !reserve_entire_route && (index == 0 || index + 1 == points.len() - 1) {
                return None;
            }
            orientation(pair[0], pair[1]).map(|_| ReservedSegment {
                start: pair[0],
                end: pair[1],
            })
        })
        .collect()
}

fn route_intersects_obstacles(
    points: &[Point],
    obstacles: &[RouteObstacle],
    source_item_id: &str,
    target_item_id: &str,
) -> bool {
    points.windows(2).enumerate().any(|(index, pair)| {
        obstacles.iter().any(|obstacle| {
            if index == 0 && obstacle.item_id == source_item_id {
                return false;
            }
            if index == points.len() - 2 && obstacle.item_id == target_item_id {
                return false;
            }
            segment_crosses_obstacle_interior(pair[0], pair[1], obstacle.bounds)
        })
    })
}

fn route_structure_valid(points: &[Point], definition: &RouteDefinition) -> bool {
    if points.len() < 2
        || !points_equal(points[0], definition.source)
        || !points_equal(points[points.len() - 1], definition.target)
        || !moves_in_side(points[0], points[1], definition.source_side)
        || !moves_in_side(
            points[points.len() - 1],
            points[points.len() - 2],
            definition.target_side,
        )
    {
        return false;
    }

    route_geometry_valid(points)
}

fn route_geometry_valid(points: &[Point]) -> bool {
    if points.windows(3).any(|window| {
        orientation(window[0], window[1]) == orientation(window[1], window[2])
            && !point_between(window[0], window[1], window[2])
    }) {
        return false;
    }

    for first_index in 0..points.len() - 1 {
        let first_start = points[first_index];
        let first_end = points[first_index + 1];
        let Some(first_orientation) = orientation(first_start, first_end) else {
            return false;
        };
        for second_index in first_index + 2..points.len() - 1 {
            let second_start = points[second_index];
            let second_end = points[second_index + 1];
            if orientation(second_start, second_end) != Some(first_orientation) {
                continue;
            }
            let overlaps = match first_orientation {
                Orientation::Horizontal => {
                    first_start.y == second_start.y
                        && ranges_overlap_beyond_point(
                            first_start.x,
                            first_end.x,
                            second_start.x,
                            second_end.x,
                        )
                }
                Orientation::Vertical => {
                    first_start.x == second_start.x
                        && ranges_overlap_beyond_point(
                            first_start.y,
                            first_end.y,
                            second_start.y,
                            second_end.y,
                        )
                }
            };
            if overlaps {
                return false;
            }
        }
    }

    true
}

fn segment_clear(first: Point, second: Point, obstacles: &[RouteObstacle]) -> bool {
    !obstacles
        .iter()
        .any(|obstacle| segment_crosses_obstacle_interior(first, second, obstacle.bounds))
}

fn point_inside_any_obstacle(point: Point, obstacles: &[RouteObstacle]) -> bool {
    obstacles
        .iter()
        .any(|obstacle| point_inside_obstacle(point, obstacle.bounds))
}

fn point_inside_obstacle(point: Point, obstacle: Rect) -> bool {
    point.x > obstacle.x
        && point.x < obstacle.right()
        && point.y > obstacle.y
        && point.y < obstacle.bottom()
}

fn ranges_overlap_beyond_point(
    first_start: f64,
    first_end: f64,
    second_start: f64,
    second_end: f64,
) -> bool {
    first_start.max(first_end).min(second_start.max(second_end))
        > first_start.min(first_end).max(second_start.min(second_end))
}

fn advance_phase(node: Point, phase: usize, anchors: &[Point]) -> usize {
    anchors
        .iter()
        .skip(phase)
        .take_while(|anchor| points_equal(node, **anchor))
        .count()
        + phase
}

fn compare_search_best(first: &SearchBest, second: &SearchBest) -> Ordering {
    first
        .cost
        .overlap_distance
        .total_cmp(&second.cost.overlap_distance)
        .then_with(|| first.cost.distance.total_cmp(&second.cost.distance))
        .then_with(|| first.cost.bends.cmp(&second.cost.bends))
        .then_with(|| first.lexical_path.cmp(&second.lexical_path))
}

fn side_direction(side: Side) -> SearchDirection {
    match side {
        Side::Left | Side::Right => SearchDirection::Horizontal,
        Side::Top | Side::Bottom => SearchDirection::Vertical,
    }
}

fn moves_in_side(first: Point, second: Point, side: Side) -> bool {
    match side {
        Side::Left => second.x < first.x,
        Side::Right => second.x > first.x,
        Side::Top => second.y < first.y,
        Side::Bottom => second.y > first.y,
    }
}

fn moves_against_side(first: Point, second: Point, side: Side) -> bool {
    match side {
        Side::Left => second.x > first.x,
        Side::Right => second.x < first.x,
        Side::Top => second.y > first.y,
        Side::Bottom => second.y < first.y,
    }
}

fn direction_rank(direction: SearchDirection) -> u8 {
    match direction {
        SearchDirection::Horizontal => 0,
        SearchDirection::Vertical => 1,
    }
}

fn lexical_node(node_id: usize) -> String {
    format!("{node_id:08}")
}

fn point_bits(point: Point) -> (u64, u64) {
    (point.x.to_bits(), point.y.to_bits())
}

fn manhattan(first: Point, second: Point) -> f64 {
    (first.x - second.x).abs() + (first.y - second.y).abs()
}

fn sort_deduplicate(values: &mut Vec<f64>) {
    values.sort_by(f64::total_cmp);
    values.dedup_by(|first, second| first.to_bits() == second.to_bits());
}

fn snap_if(value: f64, request: &ObstacleRouteRequest) -> f64 {
    if request.snap_to_grid {
        snap_value(value, request.grid_size)
    } else {
        value
    }
}

fn snap_before_if(value: f64, request: &ObstacleRouteRequest) -> f64 {
    if request.snap_to_grid {
        (value / request.grid_size).floor() * request.grid_size
    } else {
        value
    }
}

fn snap_after_if(value: f64, request: &ObstacleRouteRequest) -> f64 {
    if request.snap_to_grid {
        (value / request.grid_size).ceil() * request.grid_size
    } else {
        value
    }
}

pub fn build_route(definition: &RouteDefinition) -> Result<RoutedPath, RoutingError> {
    definition.validate()?;
    if definition.manual_bends.is_empty() {
        let source_exit = side_offset(
            definition.source,
            definition.source_side,
            definition.lane_offset,
        );
        let target_entry = side_offset(
            definition.target,
            definition.target_side,
            definition.lane_offset,
        );
        let source_horizontal = matches!(definition.source_side, Side::Left | Side::Right);
        let target_horizontal = matches!(definition.target_side, Side::Left | Side::Right);
        let mut points = vec![definition.source, source_exit];
        if source_horizontal != target_horizontal
            || endpoint_sides_face_each_other(
                definition.source_side,
                definition.target_side,
                source_exit,
                target_entry,
            )
        {
            points.push(if source_horizontal {
                Point {
                    x: source_exit.x,
                    y: target_entry.y,
                }
            } else {
                Point {
                    x: target_entry.x,
                    y: source_exit.y,
                }
            });
        } else if source_horizontal {
            if definition.source_side == definition.target_side {
                let corridor_x = match definition.source_side {
                    Side::Left => source_exit.x.min(target_entry.x) - fallback_detour(definition),
                    Side::Right => source_exit.x.max(target_entry.x) + fallback_detour(definition),
                    Side::Top | Side::Bottom => unreachable!(),
                };
                points.extend([
                    Point {
                        x: corridor_x,
                        y: source_exit.y,
                    },
                    Point {
                        x: corridor_x,
                        y: target_entry.y,
                    },
                ]);
            } else {
                let corridor_y = source_exit.y.min(target_entry.y) - fallback_detour(definition);
                points.extend([
                    Point {
                        x: source_exit.x,
                        y: corridor_y,
                    },
                    Point {
                        x: target_entry.x,
                        y: corridor_y,
                    },
                ]);
            }
        } else if definition.source_side == definition.target_side {
            let corridor_y = match definition.source_side {
                Side::Top => source_exit.y.min(target_entry.y) - fallback_detour(definition),
                Side::Bottom => source_exit.y.max(target_entry.y) + fallback_detour(definition),
                Side::Left | Side::Right => unreachable!(),
            };
            points.extend([
                Point {
                    x: source_exit.x,
                    y: corridor_y,
                },
                Point {
                    x: target_entry.x,
                    y: corridor_y,
                },
            ]);
        } else {
            let corridor_x = source_exit.x.min(target_entry.x) - fallback_detour(definition);
            points.extend([
                Point {
                    x: corridor_x,
                    y: source_exit.y,
                },
                Point {
                    x: corridor_x,
                    y: target_entry.y,
                },
            ]);
        }
        points.extend([target_entry, definition.target]);
        return Ok(RoutedPath {
            connection_id: definition.connection_id,
            points: simplify_unprotected(points),
            manual_anchor_point_indexes: Vec::new(),
        });
    }

    let mut points = vec![definition.source];
    let mut manual_anchor_point_indexes = Vec::with_capacity(definition.manual_bends.len());
    for bend in &definition.manual_bends {
        append_orthogonal(&mut points, *bend);
        manual_anchor_point_indexes.push((points.len() - 1) as u16);
    }
    append_orthogonal(&mut points, definition.target);
    Ok(RoutedPath {
        connection_id: definition.connection_id,
        points,
        manual_anchor_point_indexes,
    })
}

fn fallback_detour(definition: &RouteDefinition) -> f64 {
    definition.lane_offset.max(DEFAULT_ROUTING_GRID)
}

fn endpoint_sides_face_each_other(
    source_side: Side,
    target_side: Side,
    source_exit: Point,
    target_entry: Point,
) -> bool {
    match (source_side, target_side) {
        (Side::Left, Side::Right) => source_exit.x >= target_entry.x,
        (Side::Right, Side::Left) => source_exit.x <= target_entry.x,
        (Side::Top, Side::Bottom) => source_exit.y >= target_entry.y,
        (Side::Bottom, Side::Top) => source_exit.y <= target_entry.y,
        _ => false,
    }
}

pub fn preview_insert_manual_bend(
    definition: &RouteDefinition,
    segment_index: u16,
    pointer: Point,
    snap_grid: Option<f64>,
) -> Result<RouteEdit, RoutingError> {
    let route = build_route(definition)?;
    preview_insert_routed_bend(definition, &route, segment_index, pointer, snap_grid)
}

fn preview_insert_routed_bend(
    definition: &RouteDefinition,
    route: &RoutedPath,
    segment_index: u16,
    pointer: Point,
    snap_grid: Option<f64>,
) -> Result<RouteEdit, RoutingError> {
    pointer.validate()?;
    validate_optional_grid(snap_grid)?;
    let start = *route
        .points
        .get(usize::from(segment_index))
        .ok_or(RoutingError::InvalidSegmentIndex)?;
    let end = *route
        .points
        .get(usize::from(segment_index) + 1)
        .ok_or(RoutingError::InvalidSegmentIndex)?;
    let orientation = orientation(start, end).ok_or(RoutingError::InvalidSegmentIndex)?;
    let mut anchor = match orientation {
        Orientation::Horizontal => Point {
            x: pointer.x.clamp(start.x.min(end.x), start.x.max(end.x)),
            y: start.y,
        },
        Orientation::Vertical => Point {
            x: start.x,
            y: pointer.y.clamp(start.y.min(end.y), start.y.max(end.y)),
        },
    };
    if let Some(grid) = snap_grid {
        anchor = snap_point(anchor, grid);
    } else {
        anchor = round_point(anchor);
    }
    if points_equal(anchor, start)
        || points_equal(anchor, end)
        || definition
            .manual_bends
            .iter()
            .any(|bend| points_equal(*bend, anchor))
    {
        return Err(RoutingError::AnchorOnEndpoint);
    }

    let insertion_index = route
        .manual_anchor_point_indexes
        .iter()
        .filter(|index| **index <= segment_index)
        .count();
    let mut next = definition.clone();
    next.manual_bends.insert(insertion_index, anchor);
    route_edit(definition, next)
}

pub fn preview_remove_manual_bend(
    definition: &RouteDefinition,
    bend_index: u16,
) -> Result<RouteEdit, RoutingError> {
    let mut next = definition.clone();
    if usize::from(bend_index) >= next.manual_bends.len() {
        return Err(RoutingError::InvalidBendIndex);
    }
    next.manual_bends.remove(usize::from(bend_index));
    route_edit(definition, next)
}

pub fn preview_reset_route(definition: &RouteDefinition) -> Result<RouteEdit, RoutingError> {
    let mut next = definition.clone();
    next.manual_bends.clear();
    route_edit(definition, next)
}

pub fn preview_move_segment(
    definition: &RouteDefinition,
    segment_index: u16,
    coordinate: f64,
    snap_grid: Option<f64>,
    endpoint_snap_threshold: f64,
) -> Result<RouteEdit, RoutingError> {
    let route = build_route(definition)?;
    preview_move_routed_segment(
        definition,
        &route,
        segment_index,
        coordinate,
        snap_grid,
        endpoint_snap_threshold,
    )
}

fn preview_move_routed_segment(
    definition: &RouteDefinition,
    route: &RoutedPath,
    segment_index: u16,
    coordinate: f64,
    snap_grid: Option<f64>,
    endpoint_snap_threshold: f64,
) -> Result<RouteEdit, RoutingError> {
    definition.validate()?;
    if !coordinate.is_finite() {
        return Err(RoutingError::Geometry(GeometryError::NonFinite(
            "route segment coordinate",
        )));
    }
    validate_optional_grid(snap_grid)?;
    validate_snap_threshold(endpoint_snap_threshold)?;
    let index = usize::from(segment_index);
    let start = *route
        .points
        .get(index)
        .ok_or(RoutingError::InvalidSegmentIndex)?;
    let end = *route
        .points
        .get(index + 1)
        .ok_or(RoutingError::InvalidSegmentIndex)?;
    let orientation = orientation(start, end).ok_or(RoutingError::InvalidSegmentIndex)?;
    let mut axis = snap_grid.map_or(coordinate.round(), |grid| snap_value(coordinate, grid));
    axis = match orientation {
        Orientation::Horizontal => nearest_snap_value(
            axis,
            [definition.source.y, definition.target.y],
            endpoint_snap_threshold,
        ),
        Orientation::Vertical => nearest_snap_value(
            axis,
            [definition.source.x, definition.target.x],
            endpoint_snap_threshold,
        ),
    };

    let mut points = route.points.clone();
    let last = points.len() - 1;
    match orientation {
        Orientation::Horizontal => {
            if index == 0 && index + 1 == last {
                points.splice(
                    1..1,
                    [
                        Point {
                            x: points[0].x,
                            y: axis,
                        },
                        Point {
                            x: points[last].x,
                            y: axis,
                        },
                    ],
                );
            } else if index == 0 {
                points.insert(
                    1,
                    Point {
                        x: points[0].x,
                        y: axis,
                    },
                );
                points[2].y = axis;
            } else if index + 1 == last {
                points[index].y = axis;
                points.insert(
                    index + 1,
                    Point {
                        x: points[last].x,
                        y: axis,
                    },
                );
            } else {
                points[index].y = axis;
                points[index + 1].y = axis;
            }
        }
        Orientation::Vertical => {
            if index == 0 && index + 1 == last {
                points.splice(
                    1..1,
                    [
                        Point {
                            x: axis,
                            y: points[0].y,
                        },
                        Point {
                            x: axis,
                            y: points[last].y,
                        },
                    ],
                );
            } else if index == 0 {
                points.insert(
                    1,
                    Point {
                        x: axis,
                        y: points[0].y,
                    },
                );
                points[2].x = axis;
            } else if index + 1 == last {
                points[index].x = axis;
                points.insert(
                    index + 1,
                    Point {
                        x: axis,
                        y: points[last].y,
                    },
                );
            } else {
                points[index].x = axis;
                points[index + 1].x = axis;
            }
        }
    }
    let points = simplify_unprotected(points);
    let mut next = definition.clone();
    next.manual_bends = points[1..points.len() - 1].to_vec();
    route_edit(definition, next)
}

fn route_edit(
    previous: &RouteDefinition,
    next: RouteDefinition,
) -> Result<RouteEdit, RoutingError> {
    let route = build_route(&next)?;
    if !route_geometry_valid(&route.points) {
        return Err(RoutingError::NoRoute);
    }
    Ok(RouteEdit {
        route,
        forward: RoutePatch {
            connection_id: previous.connection_id,
            bend_points: next.manual_bends,
        },
        inverse: RoutePatch {
            connection_id: previous.connection_id,
            bend_points: previous.manual_bends.clone(),
        },
    })
}

fn append_orthogonal(points: &mut Vec<Point>, point: Point) {
    let Some(previous) = points.last().copied() else {
        points.push(point);
        return;
    };
    if points_equal(previous, point) {
        return;
    }
    if orientation(previous, point).is_none() {
        points.push(Point {
            x: previous.x,
            y: point.y,
        });
    }
    points.push(point);
}

fn simplify_unprotected(points: Vec<Point>) -> Vec<Point> {
    let mut result = Vec::with_capacity(points.len());
    for point in points {
        if result
            .last()
            .is_some_and(|previous| points_equal(*previous, point))
        {
            continue;
        }
        if result.len() >= 2 {
            let previous = result[result.len() - 1];
            let before = result[result.len() - 2];
            if orientation(before, previous) == orientation(previous, point)
                && point_between(before, previous, point)
            {
                let previous_index = result.len() - 1;
                result[previous_index] = point;
                continue;
            }
        }
        result.push(point);
    }
    result
}

fn point_between(first: Point, middle: Point, last: Point) -> bool {
    middle.x >= first.x.min(last.x)
        && middle.x <= first.x.max(last.x)
        && middle.y >= first.y.min(last.y)
        && middle.y <= first.y.max(last.y)
}

fn orientation(first: Point, second: Point) -> Option<Orientation> {
    if first.y == second.y && first.x != second.x {
        Some(Orientation::Horizontal)
    } else if first.x == second.x && first.y != second.y {
        Some(Orientation::Vertical)
    } else {
        None
    }
}

fn points_equal(first: Point, second: Point) -> bool {
    first.x == second.x && first.y == second.y
}

fn side_offset(point: Point, side: Side, distance: f64) -> Point {
    match side {
        Side::Left => Point {
            x: point.x - distance,
            y: point.y,
        },
        Side::Right => Point {
            x: point.x + distance,
            y: point.y,
        },
        Side::Top => Point {
            x: point.x,
            y: point.y - distance,
        },
        Side::Bottom => Point {
            x: point.x,
            y: point.y + distance,
        },
    }
}

fn validate_lane_offset(value: f64) -> Result<(), RoutingError> {
    if !value.is_finite() || value < MIN_LANE_OFFSET {
        return Err(RoutingError::InvalidLaneOffset);
    }
    Ok(())
}

fn validate_optional_grid(value: Option<f64>) -> Result<(), RoutingError> {
    if value.is_some_and(|grid| !grid.is_finite() || grid <= 0.0) {
        return Err(RoutingError::InvalidSnapGrid);
    }
    Ok(())
}

fn validate_snap_threshold(value: f64) -> Result<(), RoutingError> {
    if !value.is_finite() || value < 0.0 {
        return Err(RoutingError::InvalidSnapThreshold);
    }
    Ok(())
}

fn snap_value(value: f64, grid: f64) -> f64 {
    (value / grid).round() * grid
}

fn snap_point(point: Point, grid: f64) -> Point {
    Point {
        x: snap_value(point.x, grid),
        y: snap_value(point.y, grid),
    }
}

fn round_point(point: Point) -> Point {
    Point {
        x: point.x.round(),
        y: point.y.round(),
    }
}

fn nearest_snap_value(value: f64, candidates: [f64; 2], threshold: f64) -> f64 {
    candidates
        .into_iter()
        .map(|candidate| (candidate, (value - candidate).abs()))
        .filter(|(_, distance)| *distance <= threshold)
        .min_by(|first, second| {
            first
                .1
                .total_cmp(&second.1)
                .then_with(|| first.0.total_cmp(&second.0))
        })
        .map_or(value, |(candidate, _)| candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition() -> RouteDefinition {
        RouteDefinition {
            connection_id: 7,
            source: Point { x: 100.0, y: 200.0 },
            target: Point { x: 460.0, y: 80.0 },
            source_side: Side::Right,
            target_side: Side::Left,
            lane_offset: 24.0,
            manual_bends: Vec::new(),
        }
    }

    fn assert_orthogonal(points: &[Point]) {
        assert!(
            points
                .windows(2)
                .all(|pair| orientation(pair[0], pair[1]).is_some())
        );
    }

    fn assert_no_immediate_backtracking(points: &[Point]) {
        for points in points.windows(3) {
            let [first, middle, last] = points else {
                unreachable!();
            };
            if first.x == middle.x && middle.x == last.x {
                assert!(
                    middle.y >= first.y.min(last.y) && middle.y <= first.y.max(last.y),
                    "vertical route backtracks through {first:?}, {middle:?}, {last:?}"
                );
            }
            if first.y == middle.y && middle.y == last.y {
                assert!(
                    middle.x >= first.x.min(last.x) && middle.x <= first.x.max(last.x),
                    "horizontal route backtracks through {first:?}, {middle:?}, {last:?}"
                );
            }
        }
    }

    fn assert_no_redundant_collinear_points(points: &[Point]) {
        for points in points.windows(3) {
            let [first, middle, last] = points else {
                unreachable!();
            };
            assert_ne!(
                orientation(*first, *middle),
                orientation(*middle, *last),
                "route contains a redundant collinear point: {first:?}, {middle:?}, {last:?}"
            );
        }
    }

    #[test]
    fn overlap_scoring_measures_shared_segment_length() {
        let first = ReservedSegment {
            start: Point { x: 0.0, y: 12.0 },
            end: Point { x: 120.0, y: 12.0 },
        };
        let second = ReservedSegment {
            start: Point { x: 48.0, y: 18.0 },
            end: Point { x: 180.0, y: 18.0 },
        };

        assert_eq!(collinear_conflict_length(first, second, 12.0), 72.0);
        assert_eq!(collinear_conflict_length(first, second, 6.0), 0.0);
    }

    #[test]
    fn collision_avoidance_rejects_extreme_detours() {
        let shortest = vec![Point { x: 0.0, y: 0.0 }, Point { x: 120.0, y: 0.0 }];
        let extreme = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 0.0, y: -240.0 },
            Point {
                x: 120.0,
                y: -240.0,
            },
            Point { x: 120.0, y: 0.0 },
        ];

        assert_eq!(
            choose_bounded_overlap_route(Some(shortest.clone()), Some(extreme), 12.0),
            Some(shortest),
        );
    }

    #[test]
    fn collision_avoidance_accepts_a_nearby_lane() {
        let shortest = vec![Point { x: 0.0, y: 0.0 }, Point { x: 120.0, y: 0.0 }];
        let nearby = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 0.0, y: -12.0 },
            Point { x: 120.0, y: -12.0 },
            Point { x: 120.0, y: 0.0 },
        ];

        assert_eq!(
            choose_bounded_overlap_route(Some(shortest), Some(nearby.clone()), 12.0),
            Some(nearby),
        );
    }

    fn assert_endpoint_directions(points: &[Point], source_side: Side, target_side: Side) {
        let source = points[0];
        let source_exit = points[1];
        let target = points[points.len() - 1];
        let target_entry = points[points.len() - 2];
        let moves_outward = |first: Point, second: Point, side: Side| match side {
            Side::Left => second.x < first.x,
            Side::Right => second.x > first.x,
            Side::Top => second.y < first.y,
            Side::Bottom => second.y > first.y,
        };

        assert!(
            moves_outward(source, source_exit, source_side),
            "route does not leave {source_side:?} through {source:?}, {source_exit:?}"
        );
        assert!(
            moves_outward(target, target_entry, target_side),
            "route does not enter {target_side:?} through {target_entry:?}, {target:?}"
        );
    }

    fn obstacle(item_id: &str, left: f64, top: f64, right: f64, bottom: f64) -> RouteObstacle {
        RouteObstacle {
            item_id: item_id.to_owned(),
            bounds: Rect {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            },
        }
    }

    fn obstacle_request() -> ObstacleRouteRequest {
        ObstacleRouteRequest {
            definition: RouteDefinition {
                connection_id: 11,
                source: Point { x: 0.0, y: 72.0 },
                target: Point { x: 300.0, y: 72.0 },
                source_side: Side::Right,
                target_side: Side::Left,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            },
            source_candidates: Vec::new(),
            target_candidates: Vec::new(),
            source_side_constraint: None,
            target_side_constraint: None,
            previous_source_side: None,
            previous_target_side: None,
            source_item_id: "server:1".to_owned(),
            target_item_id: "patchPanel:1".to_owned(),
            obstacles: Vec::new(),
            reserved_segments: Vec::new(),
            snap_to_grid: true,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        }
    }

    fn lane_request(connection_id: u32, y: f64, avoid_cable_overlap: bool) -> LaneRouteRequest {
        let mut request = obstacle_request();
        request.definition.connection_id = connection_id;
        request.definition.source.y = y;
        request.definition.target = Point { x: 240.0, y };
        LaneRouteRequest {
            avoid_cable_overlap,
            request,
        }
    }

    fn endpoint_candidates(bounds: Rect) -> Vec<RouteEndpointCandidate> {
        vec![
            RouteEndpointCandidate {
                point: Point {
                    x: bounds.x + bounds.width / 2.0,
                    y: bounds.y,
                },
                side: Side::Top,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: bounds.right(),
                    y: bounds.y + bounds.height / 2.0,
                },
                side: Side::Right,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: bounds.x + bounds.width / 2.0,
                    y: bounds.bottom(),
                },
                side: Side::Bottom,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: bounds.x,
                    y: bounds.y + bounds.height / 2.0,
                },
                side: Side::Left,
            },
        ]
    }

    #[test]
    fn fixed_endpoint_sides_use_a_bounded_progressive_candidate_sequence() {
        let source = [
            RouteEndpointCandidate {
                point: Point { x: 0.0, y: 12.0 },
                side: Side::Right,
            },
            RouteEndpointCandidate {
                point: Point { x: 0.0, y: 0.0 },
                side: Side::Right,
            },
            RouteEndpointCandidate {
                point: Point { x: 0.0, y: 24.0 },
                side: Side::Right,
            },
        ];
        let target = [
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 12.0 },
                side: Side::Left,
            },
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 0.0 },
                side: Side::Left,
            },
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 24.0 },
                side: Side::Left,
            },
        ];

        let pairs = progressive_candidate_pairs(&source, &target);
        let coordinates = pairs
            .iter()
            .map(|(source, target)| (source.point.y, target.point.y))
            .collect::<Vec<_>>();

        assert_eq!(
            coordinates,
            vec![
                (12.0, 12.0),
                (0.0, 12.0),
                (12.0, 0.0),
                (0.0, 0.0),
                (24.0, 12.0),
                (12.0, 24.0),
                (24.0, 24.0),
            ]
        );
    }

    #[test]
    fn fixed_endpoint_sides_accept_multiple_attachment_points_on_each_face() {
        let mut request = obstacle_request();
        request.definition.source = Point { x: 120.0, y: 48.0 };
        request.definition.target = Point { x: 360.0, y: 48.0 };
        request.definition.source_side = Side::Right;
        request.definition.target_side = Side::Left;
        request.source_side_constraint = Some(Side::Right);
        request.target_side_constraint = Some(Side::Left);
        request.source_candidates = vec![
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 48.0 },
                side: Side::Right,
            },
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 36.0 },
                side: Side::Right,
            },
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 60.0 },
                side: Side::Right,
            },
        ];
        request.target_candidates = vec![
            RouteEndpointCandidate {
                point: Point { x: 360.0, y: 48.0 },
                side: Side::Left,
            },
            RouteEndpointCandidate {
                point: Point { x: 360.0, y: 36.0 },
                side: Side::Left,
            },
            RouteEndpointCandidate {
                point: Point { x: 360.0, y: 60.0 },
                side: Side::Left,
            },
        ];
        request.obstacles = vec![
            obstacle("server:1", 0.0, 0.0, 120.0, 96.0),
            obstacle("patchPanel:1", 360.0, 0.0, 480.0, 96.0),
        ];

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(
            result.route.points,
            vec![Point { x: 120.0, y: 48.0 }, Point { x: 360.0, y: 48.0 }]
        );
    }

    #[test]
    fn fixed_endpoint_sides_use_an_offset_only_to_remove_a_terminal_staircase() {
        let mut request = obstacle_request();
        request.definition.source = Point { x: 120.0, y: 48.0 };
        request.definition.target = Point { x: 360.0, y: 60.0 };
        request.definition.source_side = Side::Right;
        request.definition.target_side = Side::Left;
        request.source_side_constraint = Some(Side::Right);
        request.target_side_constraint = Some(Side::Left);
        request.source_candidates = vec![
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 48.0 },
                side: Side::Right,
            },
            RouteEndpointCandidate {
                point: Point { x: 120.0, y: 60.0 },
                side: Side::Right,
            },
        ];
        request.target_candidates = vec![
            RouteEndpointCandidate {
                point: Point { x: 360.0, y: 60.0 },
                side: Side::Left,
            },
            RouteEndpointCandidate {
                point: Point { x: 360.0, y: 72.0 },
                side: Side::Left,
            },
        ];
        request.obstacles = vec![
            obstacle("server:1", 0.0, 0.0, 120.0, 96.0),
            obstacle("patchPanel:1", 360.0, 0.0, 480.0, 96.0),
        ];

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(
            result.route.points,
            vec![Point { x: 120.0, y: 60.0 }, Point { x: 360.0, y: 60.0 }]
        );
    }

    #[test]
    fn fixed_vertical_power_ports_avoid_a_short_terminal_u_turn() {
        let mut request = obstacle_request();
        request.definition.connection_id = 72;
        request.definition.source = Point {
            x: 1168.0,
            y: 1347.0,
        };
        request.definition.target = Point {
            x: 960.0,
            y: 1003.0,
        };
        request.definition.source_side = Side::Top;
        request.definition.target_side = Side::Bottom;
        request.definition.lane_offset = 40.0;
        request.source_side_constraint = Some(Side::Top);
        request.target_side_constraint = Some(Side::Bottom);
        request.source_item_id = "ups:1".to_owned();
        request.target_item_id = "powerStrip:2".to_owned();
        request.source_candidates = vec![
            RouteEndpointCandidate {
                point: Point {
                    x: 1168.0,
                    y: 1347.0,
                },
                side: Side::Top,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: 1156.0,
                    y: 1347.0,
                },
                side: Side::Top,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: 1180.0,
                    y: 1347.0,
                },
                side: Side::Top,
            },
        ];
        request.target_candidates = vec![
            RouteEndpointCandidate {
                point: Point {
                    x: 960.0,
                    y: 1003.0,
                },
                side: Side::Bottom,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: 972.0,
                    y: 1003.0,
                },
                side: Side::Bottom,
            },
            RouteEndpointCandidate {
                point: Point {
                    x: 948.0,
                    y: 1003.0,
                },
                side: Side::Bottom,
            },
        ];
        request.snap_to_grid = true;
        request.grid_size = 12.0;
        request.obstacles = vec![
            obstacle("powerStrip:2", 876.0, 924.0, 1320.0, 1167.0),
            obstacle("ups:1", 1044.0, 1188.0, 1488.0, 1519.0),
        ];

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(
            result.route.points,
            vec![
                Point {
                    x: 1168.0,
                    y: 1347.0,
                },
                Point {
                    x: 1168.0,
                    y: 1176.0,
                },
                Point {
                    x: 960.0,
                    y: 1176.0
                },
                Point {
                    x: 960.0,
                    y: 1003.0
                },
            ]
        );
        assert!(
            !has_short_terminal_staircase(&result.route.points, request.grid_size),
            "route retained a short terminal U-turn: {:?}",
            result.route.points
        );
        assert!(
            result.route.points.len() <= 4,
            "route used unnecessary bends: {:?}",
            result.route.points
        );
    }

    fn plan_request(requests: Vec<LaneRouteRequest>) -> CableRoutePlanRequest {
        CableRoutePlanRequest {
            obstacles: Vec::new(),
            requests,
            seed: None,
        }
    }

    #[test]
    fn automatic_endpoint_selection_uses_facing_vertical_sides() {
        let source_bounds = Rect {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 80.0,
        };
        let target_bounds = Rect {
            x: 0.0,
            y: 300.0,
            width: 120.0,
            height: 80.0,
        };
        let mut request = obstacle_request();
        request.definition.source = Point { x: 60.0, y: 0.0 };
        request.definition.target = Point { x: 60.0, y: 300.0 };
        request.source_candidates = endpoint_candidates(source_bounds);
        request.target_candidates = endpoint_candidates(target_bounds);
        request.obstacles = vec![
            RouteObstacle {
                item_id: request.source_item_id.clone(),
                bounds: source_bounds,
            },
            RouteObstacle {
                item_id: request.target_item_id.clone(),
                bounds: target_bounds,
            },
        ];

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(result.source_side, Side::Bottom);
        assert_eq!(result.target_side, Side::Top);
        assert_endpoint_directions(&result.route.points, Side::Bottom, Side::Top);
    }

    #[test]
    fn clear_facing_ports_use_one_exact_straight_segment() {
        let source = Point { x: 120.0, y: 48.0 };
        let target = Point { x: 360.0, y: 48.0 };
        let request = ObstacleRouteRequest {
            definition: RouteDefinition {
                connection_id: 40,
                source,
                target,
                source_side: Side::Right,
                target_side: Side::Left,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            },
            source_candidates: Vec::new(),
            target_candidates: Vec::new(),
            source_side_constraint: Some(Side::Right),
            target_side_constraint: Some(Side::Left),
            previous_source_side: None,
            previous_target_side: None,
            source_item_id: "switch:1".to_owned(),
            target_item_id: "switch:2".to_owned(),
            obstacles: vec![
                obstacle("switch:1", 0.0, 0.0, 120.0, 96.0),
                obstacle("switch:2", 360.0, 0.0, 480.0, 96.0),
            ],
            reserved_segments: Vec::new(),
            snap_to_grid: true,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        };

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(result.route.points, vec![source, target]);
        assert_eq!(result.source_side, Side::Right);
        assert_eq!(result.target_side, Side::Left);
    }

    #[test]
    fn clear_perpendicular_ports_use_one_bend_and_exact_centers() {
        let source = Point { x: 120.0, y: 48.0 };
        let target = Point { x: 408.0, y: 300.0 };
        let request = ObstacleRouteRequest {
            definition: RouteDefinition {
                connection_id: 41,
                source,
                target,
                source_side: Side::Right,
                target_side: Side::Top,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            },
            source_candidates: Vec::new(),
            target_candidates: Vec::new(),
            source_side_constraint: Some(Side::Right),
            target_side_constraint: Some(Side::Top),
            previous_source_side: None,
            previous_target_side: None,
            source_item_id: "server:1".to_owned(),
            target_item_id: "ups:1".to_owned(),
            obstacles: vec![
                obstacle("server:1", 0.0, 0.0, 120.0, 96.0),
                obstacle("ups:1", 360.0, 300.0, 456.0, 444.0),
            ],
            reserved_segments: Vec::new(),
            snap_to_grid: true,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        };

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(
            result.route.points,
            vec![source, Point { x: 408.0, y: 48.0 }, target]
        );
        assert_endpoint_directions(&result.route.points, Side::Right, Side::Top);
    }

    #[test]
    fn planner_canonicalizes_connection_28_terminal_overlap() {
        let source = Point { x: 2749.0, y: 11.0 };
        let target = Point {
            x: 1496.0,
            y: -457.0,
        };
        let mut request = obstacle_request();
        request.definition = RouteDefinition {
            connection_id: 28,
            source,
            target,
            source_side: Side::Left,
            target_side: Side::Top,
            lane_offset: 32.0,
            manual_bends: vec![
                Point { x: 2688.0, y: 42.0 },
                Point {
                    x: 2688.0,
                    y: -624.0,
                },
                Point {
                    x: 1496.0,
                    y: -624.0,
                },
            ],
        };
        request.source_side_constraint = Some(Side::Left);
        request.target_side_constraint = Some(Side::Top);
        request.source_candidates = vec![RouteEndpointCandidate {
            point: source,
            side: Side::Left,
        }];
        request.target_candidates = vec![RouteEndpointCandidate {
            point: target,
            side: Side::Top,
        }];

        let plan = RoutePlanner::default()
            .plan(&plan_request(vec![LaneRouteRequest {
                avoid_cable_overlap: true,
                request,
            }]))
            .unwrap();

        assert!(plan.failures.is_empty());
        assert_eq!(plan.routes.len(), 1);
        assert_eq!(plan.routes[0].route.points.first(), Some(&source));
        assert_eq!(
            plan.repairs,
            vec![CableRouteRepair {
                connection_id: 28,
                bend_points: vec![
                    Point { x: 2688.0, y: 11.0 },
                    Point {
                        x: 2688.0,
                        y: -624.0,
                    },
                    Point {
                        x: 1496.0,
                        y: -624.0,
                    },
                ],
                reason: RouteRepairReason::TerminalOverlap,
            }]
        );
        assert_eq!(
            plan.routes[0].route.manual_anchor_point_indexes,
            vec![1, 2, 3]
        );
        assert_eq!(
            plan.routes[0].route.points,
            vec![
                source,
                Point { x: 2688.0, y: 11.0 },
                Point {
                    x: 2688.0,
                    y: -624.0,
                },
                Point {
                    x: 1496.0,
                    y: -624.0,
                },
                target,
            ]
        );
    }

    #[test]
    fn terminal_canonicalization_supports_every_endpoint_side() {
        let cases = [
            (
                Side::Left,
                Point { x: 100.0, y: 100.0 },
                Point { x: 40.0, y: 130.0 },
                Point { x: 40.0, y: 40.0 },
                Point { x: 40.0, y: 100.0 },
            ),
            (
                Side::Right,
                Point { x: 100.0, y: 100.0 },
                Point { x: 160.0, y: 130.0 },
                Point { x: 160.0, y: 40.0 },
                Point { x: 160.0, y: 100.0 },
            ),
            (
                Side::Top,
                Point { x: 100.0, y: 100.0 },
                Point { x: 130.0, y: 40.0 },
                Point { x: 40.0, y: 40.0 },
                Point { x: 100.0, y: 40.0 },
            ),
            (
                Side::Bottom,
                Point { x: 100.0, y: 100.0 },
                Point { x: 130.0, y: 160.0 },
                Point { x: 40.0, y: 160.0 },
                Point { x: 100.0, y: 160.0 },
            ),
        ];

        for (side, endpoint, mut terminal, next, expected) in cases {
            canonicalize_source_terminal(endpoint, side, &mut terminal, next);
            assert_eq!(terminal, expected);

            let mut target_terminal = match side {
                Side::Left => Point { x: 40.0, y: 130.0 },
                Side::Right => Point { x: 160.0, y: 130.0 },
                Side::Top => Point { x: 130.0, y: 40.0 },
                Side::Bottom => Point { x: 130.0, y: 160.0 },
            };
            canonicalize_target_terminal(endpoint, side, next, &mut target_terminal);
            assert_eq!(target_terminal, expected);
        }
    }

    #[test]
    fn automatic_endpoint_selection_respects_manual_side_constraints() {
        let source_bounds = Rect {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 80.0,
        };
        let target_bounds = Rect {
            x: 360.0,
            y: 0.0,
            width: 120.0,
            height: 80.0,
        };
        let mut request = obstacle_request();
        request.source_candidates = endpoint_candidates(source_bounds);
        request.target_candidates = endpoint_candidates(target_bounds);
        request.source_side_constraint = Some(Side::Top);
        request.target_side_constraint = Some(Side::Bottom);
        request.obstacles = vec![
            RouteObstacle {
                item_id: request.source_item_id.clone(),
                bounds: source_bounds,
            },
            RouteObstacle {
                item_id: request.target_item_id.clone(),
                bounds: target_bounds,
            },
        ];

        let result = route_around_obstacles(&request).unwrap();

        assert_eq!(result.source_side, Side::Top);
        assert_eq!(result.target_side, Side::Bottom);
        assert_endpoint_directions(&result.route.points, Side::Top, Side::Bottom);
    }

    #[test]
    fn every_explicit_endpoint_side_pair_routes_outside_both_cards() {
        let source_bounds = Rect {
            x: 0.0,
            y: 100.0,
            width: 120.0,
            height: 100.0,
        };
        let target_bounds = Rect {
            x: 420.0,
            y: 100.0,
            width: 120.0,
            height: 100.0,
        };
        let sides = [Side::Top, Side::Right, Side::Bottom, Side::Left];

        for (source_index, source_side) in sides.into_iter().enumerate() {
            for (target_index, target_side) in sides.into_iter().enumerate() {
                let mut request = obstacle_request();
                request.definition.connection_id =
                    100 + (source_index * sides.len() + target_index) as u32;
                request.source_candidates = endpoint_candidates(source_bounds);
                request.target_candidates = endpoint_candidates(target_bounds);
                request.source_side_constraint = Some(source_side);
                request.target_side_constraint = Some(target_side);
                request.obstacles = vec![
                    RouteObstacle {
                        item_id: request.source_item_id.clone(),
                        bounds: source_bounds,
                    },
                    RouteObstacle {
                        item_id: request.target_item_id.clone(),
                        bounds: target_bounds,
                    },
                ];

                let result = route_around_obstacles(&request).unwrap_or_else(|error| {
                    panic!("failed to route {source_side:?} to {target_side:?}: {error}")
                });

                assert_eq!(result.source_side, source_side);
                assert_eq!(result.target_side, target_side);
                assert_orthogonal(&result.route.points);
                assert_no_immediate_backtracking(&result.route.points);
                assert_no_redundant_collinear_points(&result.route.points);
                assert_endpoint_directions(&result.route.points, source_side, target_side);
                assert!(!route_intersects_equipment_clearance(
                    &result.route.points,
                    &request.obstacles,
                    &request.source_item_id,
                    &request.target_item_id,
                ));
            }
        }
    }

    #[test]
    fn perimeter_fallback_keeps_a_safe_route_when_the_direct_corridor_is_blocked() {
        let source_bounds = Rect {
            x: 0.0,
            y: 100.0,
            width: 80.0,
            height: 80.0,
        };
        let target_bounds = Rect {
            x: 400.0,
            y: 100.0,
            width: 80.0,
            height: 80.0,
        };
        let mut request = obstacle_request();
        request.source_candidates = endpoint_candidates(source_bounds);
        request.target_candidates = endpoint_candidates(target_bounds);
        request.obstacles = vec![
            obstacle("server:1", 0.0, 100.0, 80.0, 180.0),
            obstacle("patchPanel:1", 400.0, 100.0, 480.0, 180.0),
            obstacle("switch:1", 160.0, -100.0, 320.0, 400.0),
        ];

        let source_candidates = endpoint_candidates(source_bounds);
        let target_candidates = endpoint_candidates(target_bounds);
        let candidate_pairs = source_candidates
            .iter()
            .flat_map(|source| target_candidates.iter().map(move |target| (source, target)))
            .collect::<Vec<_>>();
        let result = perimeter_fallback_route(&request, &candidate_pairs)
            .expect("outer perimeter should remain reachable");

        assert!(result.used_fallback);
        assert_eq!(result.warning, Some(RouteWarning::SearchExhausted));
        assert_endpoint_directions(&result.route.points, result.source_side, result.target_side);
        assert!(!route_intersects_equipment_clearance(
            &result.route.points,
            &request.obstacles,
            &request.source_item_id,
            &request.target_item_id,
        ));
    }

    #[test]
    fn default_route_is_orthogonal_and_side_aware() {
        let route = build_route(&definition()).unwrap();
        assert_eq!(
            route.points,
            vec![
                Point { x: 100.0, y: 200.0 },
                Point { x: 124.0, y: 200.0 },
                Point { x: 124.0, y: 80.0 },
                Point { x: 460.0, y: 80.0 },
            ]
        );
        assert_orthogonal(&route.points);
    }

    #[test]
    fn default_route_does_not_backtrack_between_opposing_sides() {
        for (index, (source_side, target_side)) in [
            (Side::Top, Side::Bottom),
            (Side::Bottom, Side::Top),
            (Side::Left, Side::Right),
            (Side::Right, Side::Left),
        ]
        .into_iter()
        .enumerate()
        {
            let route = build_route(&RouteDefinition {
                connection_id: 40 + index as u32,
                source: Point { x: 100.0, y: 200.0 },
                target: Point { x: 460.0, y: 320.0 },
                source_side,
                target_side,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            })
            .unwrap();

            assert_orthogonal(&route.points);
            assert_no_immediate_backtracking(&route.points);
            assert_endpoint_directions(&route.points, source_side, target_side);
        }
    }

    #[test]
    fn explicit_anchor_survives_collinear_normalization() {
        let mut route = definition();
        route.manual_bends = vec![Point { x: 100.0, y: 150.0 }];
        let built = build_route(&route).unwrap();
        assert_eq!(built.manual_anchor_point_indexes, vec![1]);
        assert_eq!(built.points[1], Point { x: 100.0, y: 150.0 });
        assert_orthogonal(&built.points);
    }

    #[test]
    fn obstacle_router_uses_a_short_bounded_detour() {
        let mut request = obstacle_request();
        request.obstacles = vec![obstacle("switch:1", 84.0, 12.0, 216.0, 132.0)];
        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        assert_eq!(result.warning, None);
        assert_orthogonal(&result.route.points);
        assert!(
            result
                .route
                .points
                .iter()
                .any(|point| point.y <= 6.0 || point.y >= 138.0)
        );
        let expanded = expanded_routing_obstacles(&request.obstacles);
        assert!(result.route.points.windows(2).all(|pair| {
            !segment_crosses_obstacle_interior(pair[0], pair[1], expanded[0].bounds)
        }));
        assert!(
            result
                .route
                .points
                .iter()
                .all(|point| point.x.abs() < 500.0)
        );
    }

    #[test]
    fn obstacle_router_uses_adaptive_portals_between_adjacent_switches() {
        let request = ObstacleRouteRequest {
            definition: RouteDefinition {
                connection_id: 1,
                source: Point {
                    x: 687.0,
                    y: -438.0,
                },
                target: Point {
                    x: 1657.0,
                    y: -418.0,
                },
                source_side: Side::Right,
                target_side: Side::Left,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            },
            source_candidates: Vec::new(),
            target_candidates: Vec::new(),
            source_side_constraint: None,
            target_side_constraint: None,
            previous_source_side: None,
            previous_target_side: None,
            source_item_id: "switch:9".to_owned(),
            target_item_id: "switch:1".to_owned(),
            obstacles: vec![
                obstacle("switch:9", 300.0, -564.0, 710.0, -394.0),
                obstacle("switch:10", 732.0, -564.0, 1142.0, -394.0),
                obstacle("switch:11", 1164.0, -564.0, 1574.0, -394.0),
                obstacle("switch:1", 1596.0, -564.0, 1902.0, -374.0),
            ],
            reserved_segments: Vec::new(),
            snap_to_grid: true,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        };

        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        assert_eq!(result.warning, None);
        assert_endpoint_directions(&result.route.points, Side::Right, Side::Left);
        assert!(result.route.points.windows(2).all(|pair| {
            request.obstacles[1..3].iter().all(|intermediate| {
                !segment_crosses_obstacle_interior(pair[0], pair[1], intermediate.bounds)
            })
        }));
        assert!(
            result
                .route
                .points
                .iter()
                .any(|point| point.y <= -576.0 || point.y >= -384.0),
            "route did not clear the switch row: {:?}",
            result.route.points
        );
    }

    #[test]
    fn fallback_route_rejects_geometry_that_crosses_equipment() {
        let mut request = obstacle_request();
        request.previous_valid_route = Some(build_route(&request.definition).unwrap());
        request.obstacles = vec![obstacle("switch:1", 80.0, 60.0, 220.0, 84.0)];

        assert_eq!(fallback_route(&request), Err(RoutingError::NoRoute));
    }

    #[test]
    fn obstacle_router_enters_endpoint_items_only_through_configured_sides() {
        let request = ObstacleRouteRequest {
            definition: RouteDefinition {
                connection_id: 12,
                source: Point { x: 100.0, y: 50.0 },
                target: Point { x: 350.0, y: 300.0 },
                source_side: Side::Right,
                target_side: Side::Bottom,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            },
            source_candidates: Vec::new(),
            target_candidates: Vec::new(),
            source_side_constraint: None,
            target_side_constraint: None,
            previous_source_side: None,
            previous_target_side: None,
            source_item_id: "server:1".to_owned(),
            target_item_id: "powerStrip:1".to_owned(),
            obstacles: vec![
                obstacle("server:1", -12.0, -12.0, 112.0, 112.0),
                obstacle("powerStrip:1", 288.0, 188.0, 412.0, 312.0),
            ],
            reserved_segments: Vec::new(),
            snap_to_grid: false,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        };
        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        assert_endpoint_directions(&result.route.points, Side::Right, Side::Bottom);
        assert!(result.route.points[1].x > request.obstacles[0].bounds.right());
        assert!(
            result.route.points[result.route.points.len() - 2].y
                > request.obstacles[1].bounds.bottom()
        );
        assert_orthogonal(&result.route.points);
        for pair in result.route.points[1..result.route.points.len() - 1].windows(2) {
            assert!(!segment_crosses_obstacle_interior(
                pair[0],
                pair[1],
                request.obstacles[0].bounds
            ));
            assert!(!segment_crosses_obstacle_interior(
                pair[0],
                pair[1],
                request.obstacles[1].bounds
            ));
        }
    }

    #[test]
    fn obstacle_router_does_not_backtrack_between_opposing_endpoint_sides() {
        let cases = [
            (
                Side::Top,
                Side::Bottom,
                Point { x: 60.0, y: 120.0 },
                Point { x: 620.0, y: 300.0 },
            ),
            (
                Side::Bottom,
                Side::Top,
                Point { x: 60.0, y: 300.0 },
                Point { x: 620.0, y: 120.0 },
            ),
            (
                Side::Left,
                Side::Right,
                Point { x: 0.0, y: 180.0 },
                Point { x: 780.0, y: 180.0 },
            ),
            (
                Side::Right,
                Side::Left,
                Point { x: 240.0, y: 180.0 },
                Point { x: 540.0, y: 180.0 },
            ),
        ];

        for (index, (source_side, target_side, source, target)) in cases.into_iter().enumerate() {
            let request = ObstacleRouteRequest {
                definition: RouteDefinition {
                    connection_id: 20 + index as u32,
                    source,
                    target,
                    source_side,
                    target_side,
                    lane_offset: 24.0,
                    manual_bends: Vec::new(),
                },
                source_candidates: Vec::new(),
                target_candidates: Vec::new(),
                source_side_constraint: None,
                target_side_constraint: None,
                previous_source_side: None,
                previous_target_side: None,
                source_item_id: "patchPanel:1".to_owned(),
                target_item_id: "switch:1".to_owned(),
                obstacles: vec![
                    obstacle("patchPanel:1", -12.0, 108.0, 252.0, 312.0),
                    obstacle("switch:1", 528.0, 108.0, 792.0, 312.0),
                ],
                reserved_segments: Vec::new(),
                snap_to_grid: false,
                grid_size: DEFAULT_ROUTING_GRID,
                previous_valid_route: None,
            };

            let result = route_around_obstacles(&request).unwrap();
            assert!(
                !result.used_fallback,
                "case {index} unexpectedly used fallback"
            );
            assert_orthogonal(&result.route.points);
            assert_no_immediate_backtracking(&result.route.points);
            assert_endpoint_directions(&result.route.points, source_side, target_side);
            for pair in result.route.points[1..result.route.points.len() - 1].windows(2) {
                assert!(!segment_crosses_obstacle_interior(
                    pair[0],
                    pair[1],
                    request.obstacles[0].bounds
                ));
                assert!(!segment_crosses_obstacle_interior(
                    pair[0],
                    pair[1],
                    request.obstacles[1].bounds
                ));
            }
        }
    }

    #[test]
    fn obstacle_router_includes_distant_card_edge_portals_in_search_bounds() {
        let request = ObstacleRouteRequest {
            definition: RouteDefinition {
                connection_id: 33,
                source: Point { x: 100.0, y: 250.0 },
                target: Point { x: 700.0, y: 300.0 },
                source_side: Side::Top,
                target_side: Side::Bottom,
                lane_offset: 24.0,
                manual_bends: Vec::new(),
            },
            source_candidates: Vec::new(),
            target_candidates: Vec::new(),
            source_side_constraint: None,
            target_side_constraint: None,
            previous_source_side: None,
            previous_target_side: None,
            source_item_id: "patchPanel:1".to_owned(),
            target_item_id: "switch:1".to_owned(),
            obstacles: vec![
                obstacle("patchPanel:1", -12.0, -12.0, 412.0, 512.0),
                obstacle("switch:1", 588.0, 88.0, 1012.0, 412.0),
            ],
            reserved_segments: Vec::new(),
            snap_to_grid: false,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        };

        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        assert_eq!(result.route.points[1], Point { x: 100.0, y: -36.0 });
        assert_eq!(
            result.route.points[result.route.points.len() - 2],
            Point { x: 700.0, y: 436.0 }
        );
        assert_orthogonal(&result.route.points);
        assert_no_immediate_backtracking(&result.route.points);
        assert_endpoint_directions(&result.route.points, Side::Top, Side::Bottom);
    }

    #[test]
    fn obstacle_router_preserves_manual_anchor_order() {
        let mut request = obstacle_request();
        request.definition.manual_bends =
            vec![Point { x: 72.0, y: 168.0 }, Point { x: 228.0, y: 168.0 }];
        request.obstacles = vec![obstacle("switch:1", 84.0, 12.0, 216.0, 132.0)];
        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        assert_eq!(result.route.manual_anchor_point_indexes.len(), 2);
        assert!(
            result.route.manual_anchor_point_indexes[0]
                < result.route.manual_anchor_point_indexes[1]
        );
        for (anchor, index) in request
            .definition
            .manual_bends
            .iter()
            .zip(&result.route.manual_anchor_point_indexes)
        {
            assert_eq!(result.route.points[usize::from(*index)], *anchor);
        }
    }

    #[test]
    fn covered_manual_anchor_is_projected_without_mutating_definition() {
        let mut request = obstacle_request();
        let anchor = Point { x: 144.0, y: 72.0 };
        request.definition.manual_bends = vec![anchor];
        request.obstacles = vec![obstacle("nas:1", 120.0, 48.0, 180.0, 96.0)];
        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        let index = usize::from(result.route.manual_anchor_point_indexes[0]);
        assert_ne!(result.route.points[index], anchor);
        assert_eq!(request.definition.manual_bends, vec![anchor]);
    }

    #[test]
    fn bounded_search_returns_the_previous_complete_route_when_blocked() {
        let mut request = obstacle_request();
        let previous = build_route(&request.definition).unwrap();
        request.previous_valid_route = Some(previous.clone());
        request.obstacles = vec![obstacle("wall:1", 80.0, -300.0, 220.0, 300.0)];
        let result = route_around_obstacles(&request).unwrap();

        assert!(!result.used_fallback);
        assert_eq!(result.warning, None);
        assert_ne!(result.route, previous);
        assert_orthogonal(&result.route.points);
    }

    #[test]
    fn planner_does_not_restore_cached_manual_geometry_after_reset() {
        let mut planner = RoutePlanner::default();
        let mut moved = lane_request(1, 72.0, false);
        moved.request.definition.manual_bends =
            vec![Point { x: 48.0, y: 168.0 }, Point { x: 192.0, y: 168.0 }];
        let initial = planner.plan(&plan_request(vec![moved.clone()])).unwrap();
        let cached_route = initial.routes[0].route.clone();
        assert!(!cached_route.manual_anchor_point_indexes.is_empty());

        let mut reset = moved;
        reset.request.definition.manual_bends.clear();
        let result = planner
            .plan(&CableRoutePlanRequest {
                obstacles: vec![obstacle("wall:1", 80.0, -300.0, 220.0, 300.0)],
                requests: vec![reset],
                seed: None,
            })
            .unwrap();

        assert!(!result.routes[0].used_fallback);
        assert_ne!(result.routes[0].route, cached_route);
        assert!(
            result.routes[0]
                .route
                .manual_anchor_point_indexes
                .is_empty()
        );
    }

    #[test]
    fn planner_separates_collinear_routes_in_numeric_order() {
        let mut planner = RoutePlanner::default();
        let plan = planner
            .plan(&plan_request(vec![
                lane_request(3, 24.0, true),
                lane_request(1, 24.0, true),
                lane_request(2, 24.0, true),
            ]))
            .unwrap();

        assert_eq!(plan.recalculated_connection_ids, vec![1, 2, 3]);
        assert_eq!(
            plan.routes
                .iter()
                .map(|result| result.route.connection_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        for first in 0..plan.routes.len() {
            for second in first + 1..plan.routes.len() {
                assert!(
                    !reservable_segments(&plan.routes[first].route.points)
                        .iter()
                        .any(|first_segment| {
                            reservable_segments(&plan.routes[second].route.points)
                                .iter()
                                .any(|second_segment| {
                                    segments_have_collinear_conflict(
                                        *first_segment,
                                        *second_segment,
                                        DEFAULT_ROUTING_GRID,
                                    )
                                })
                        })
                );
            }
        }
    }

    #[test]
    fn planner_bounds_cold_route_work_and_continues_from_its_internal_cache() {
        let mut planner = RoutePlanner::default();
        let request = plan_request(
            (1..=5)
                .map(|connection_id| {
                    lane_request(connection_id, f64::from(connection_id) * 24.0, false)
                })
                .collect(),
        );

        let first = planner.plan(&request).unwrap();
        assert_eq!(first.recalculated_connection_ids, vec![1, 2, 3, 4]);
        assert_eq!(first.deferred_connection_ids, vec![5]);
        assert_eq!(first.routes.len(), 4);

        let second = planner.plan(&request).unwrap();
        assert_eq!(second.recalculated_connection_ids, vec![5]);
        assert!(second.deferred_connection_ids.is_empty());
        assert_eq!(
            second
                .routes
                .iter()
                .map(|route| route.route.connection_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5]
        );
    }

    #[test]
    fn planner_continuation_does_not_restart_completed_overlap_aware_routes() {
        let mut planner = RoutePlanner::default();
        let request = plan_request(
            (1..=9)
                .map(|connection_id| lane_request(connection_id, 24.0, true))
                .collect(),
        );

        let first = planner.plan(&request).unwrap();
        assert_eq!(first.recalculated_connection_ids, vec![1, 2, 3, 4]);
        assert_eq!(first.deferred_connection_ids, vec![5, 6, 7, 8, 9]);

        let second = planner.plan(&request).unwrap();
        assert_eq!(second.recalculated_connection_ids, vec![5, 6, 7, 8]);
        assert_eq!(second.deferred_connection_ids, vec![9]);

        let third = planner.plan(&request).unwrap();
        assert_eq!(third.recalculated_connection_ids, vec![9]);
        assert!(third.deferred_connection_ids.is_empty());
        assert_eq!(third.routes.len(), 9);
    }

    #[test]
    fn planner_reuses_unchanged_routes_and_invalidates_only_dependants() {
        let mut planner = RoutePlanner::default();
        let initial = vec![
            lane_request(1, 24.0, false),
            lane_request(2, 60.0, false),
            lane_request(3, 24.0, true),
        ];
        planner.plan(&plan_request(initial.clone())).unwrap();
        let unchanged = planner.plan(&plan_request(initial)).unwrap();
        assert!(unchanged.recalculated_connection_ids.is_empty());

        let changed = vec![
            lane_request(1, 36.0, false),
            lane_request(2, 60.0, false),
            lane_request(3, 24.0, true),
        ];
        let changed_plan = planner.plan(&plan_request(changed)).unwrap();
        assert_eq!(changed_plan.recalculated_connection_ids, vec![1, 3]);
    }

    #[test]
    fn planner_hydrates_persisted_routes_without_recalculation() {
        let mut original = RoutePlanner::default();
        let requests = vec![lane_request(1, 24.0, false), lane_request(2, 60.0, false)];
        let initial = original.plan(&plan_request(requests.clone())).unwrap();
        let seed = CableRouteCacheSeed {
            obstacles: Vec::new(),
            entries: requests
                .iter()
                .cloned()
                .zip(initial.routes.iter().cloned())
                .map(|(input, result)| CachedLaneRouteSeed { input, result })
                .collect(),
        };
        let mut restored = RoutePlanner::default();
        let plan = restored
            .plan(&CableRoutePlanRequest {
                obstacles: Vec::new(),
                requests,
                seed: Some(seed),
            })
            .unwrap();

        assert!(plan.recalculated_connection_ids.is_empty());
        assert!(plan.failures.is_empty());
        assert_eq!(plan.routes, initial.routes);
    }

    #[test]
    fn planner_rejects_cached_endpoints_outside_current_candidates() {
        let requests = vec![lane_request(1, 24.0, false)];
        let mut original = RoutePlanner::default();
        let initial = original.plan(&plan_request(requests.clone())).unwrap();
        let mut stale = initial.routes[0].clone();
        stale.route.points = vec![
            Point { x: 0.0, y: 36.0 },
            Point { x: 120.0, y: 36.0 },
            Point { x: 120.0, y: 24.0 },
            Point { x: 240.0, y: 24.0 },
        ];
        let seed = CableRouteCacheSeed {
            obstacles: Vec::new(),
            entries: vec![CachedLaneRouteSeed {
                input: requests[0].clone(),
                result: stale,
            }],
        };

        let plan = RoutePlanner::default()
            .plan(&CableRoutePlanRequest {
                obstacles: Vec::new(),
                requests,
                seed: Some(seed),
            })
            .unwrap();

        assert_eq!(plan.recalculated_connection_ids, vec![1]);
        assert_eq!(
            plan.routes[0].route.points.first(),
            Some(&Point { x: 0.0, y: 24.0 })
        );
        assert!(plan.failures.is_empty());
    }

    #[test]
    fn planner_does_not_invalidate_dependants_when_changed_input_keeps_same_route() {
        let mut planner = RoutePlanner::default();
        let initial = vec![lane_request(1, 24.0, false), lane_request(2, 24.0, true)];
        planner.plan(&plan_request(initial.clone())).unwrap();
        let plan = planner
            .plan(&CableRoutePlanRequest {
                obstacles: vec![obstacle(
                    "distant:1",
                    10_000.0,
                    10_000.0,
                    10_100.0,
                    10_100.0,
                )],
                requests: initial,
                seed: None,
            })
            .unwrap();

        assert!(plan.recalculated_connection_ids.is_empty());
    }

    #[test]
    fn changed_obstacles_invalidate_only_nearby_or_attached_routes() {
        let mut planner = RoutePlanner::default();
        let requests = vec![lane_request(1, 24.0, false), lane_request(2, 240.0, false)];
        planner.plan(&plan_request(requests.clone())).unwrap();

        let nearby = planner
            .plan(&CableRoutePlanRequest {
                obstacles: vec![obstacle("rack:1", 96.0, 12.0, 144.0, 48.0)],
                requests: requests.clone(),
                seed: None,
            })
            .unwrap();
        assert_eq!(nearby.recalculated_connection_ids, vec![1]);

        let attached = planner
            .plan(&CableRoutePlanRequest {
                obstacles: vec![obstacle("server:1", -24.0, 216.0, 24.0, 264.0)],
                requests,
                seed: None,
            })
            .unwrap();
        assert_eq!(attached.recalculated_connection_ids, vec![1, 2]);
    }

    #[test]
    fn removing_a_reserved_route_invalidates_remaining_overlap_aware_routes() {
        let mut planner = RoutePlanner::default();
        planner
            .plan(&plan_request(vec![
                lane_request(1, 24.0, false),
                lane_request(2, 24.0, true),
            ]))
            .unwrap();
        let plan = planner
            .plan(&plan_request(vec![lane_request(2, 24.0, true)]))
            .unwrap();

        assert_eq!(plan.recalculated_connection_ids, vec![2]);
    }

    #[test]
    fn planner_edits_the_cached_obstacle_route_segments() {
        let mut planner = RoutePlanner::default();
        let entry = lane_request(1, 72.0, false);
        let plan = planner
            .plan(&CableRoutePlanRequest {
                obstacles: vec![obstacle("switch:1", 84.0, 12.0, 216.0, 132.0)],
                requests: vec![entry],
                seed: None,
            })
            .unwrap();
        let route = &plan.routes[0].route;
        let segment_index = route
            .points
            .windows(2)
            .position(|pair| pair[0].y == pair[1].y && (pair[1].x - pair[0].x).abs() > 100.0)
            .unwrap() as u16;

        let moved = planner
            .preview_move_segment(1, segment_index, 156.0, Some(12.0), 8.0)
            .unwrap();
        assert!(
            moved
                .forward
                .bend_points
                .iter()
                .any(|point| point.y == 156.0)
        );
        assert_orthogonal(&moved.route.points);

        let segment_start = route.points[usize::from(segment_index)];
        let segment_end = route.points[usize::from(segment_index) + 1];
        let anchor = Point {
            x: ((segment_start.x + segment_end.x) / 2.0 / 12.0).round() * 12.0,
            y: segment_start.y,
        };
        let inserted = planner
            .preview_insert_manual_bend(1, segment_index, anchor, Some(12.0))
            .unwrap();
        assert!(inserted.forward.bend_points.contains(&anchor));
    }

    #[test]
    fn horizontal_segment_moves_only_vertically_with_inverse_patch() {
        let edit = preview_move_segment(&definition(), 2, 131.0, None, 8.0).unwrap();
        assert_eq!(
            edit.route.points,
            vec![
                Point { x: 100.0, y: 200.0 },
                Point { x: 124.0, y: 200.0 },
                Point { x: 124.0, y: 131.0 },
                Point { x: 460.0, y: 131.0 },
                Point { x: 460.0, y: 80.0 },
            ]
        );
        assert!(edit.inverse.bend_points.is_empty());
        assert_eq!(edit.forward.bend_points, edit.route.points[1..4]);
    }

    #[test]
    fn vertical_segment_snaps_to_source_center() {
        let edit = preview_move_segment(&definition(), 1, 103.0, None, 8.0).unwrap();
        assert_eq!(edit.route.points.len(), 3);
        assert_eq!(edit.route.points[0].x, 100.0);
        assert_eq!(edit.route.points[1].x, 100.0);
    }

    #[test]
    fn insert_remove_and_reset_preserve_inverse_bends() {
        let inserted =
            preview_insert_manual_bend(&definition(), 1, Point { x: 124.0, y: 140.0 }, None)
                .unwrap();
        assert_eq!(
            inserted.forward.bend_points,
            vec![Point { x: 124.0, y: 140.0 }]
        );
        assert!(inserted.inverse.bend_points.is_empty());

        let mut with_bend = definition();
        with_bend.manual_bends = inserted.forward.bend_points.clone();
        let removed = preview_remove_manual_bend(&with_bend, 0).unwrap();
        assert!(removed.forward.bend_points.is_empty());
        assert_eq!(removed.inverse.bend_points, with_bend.manual_bends);

        let reset = preview_reset_route(&with_bend).unwrap();
        assert!(reset.forward.bend_points.is_empty());
        assert_eq!(reset.inverse.bend_points, with_bend.manual_bends);
    }

    #[test]
    fn invalid_numbers_and_indexes_are_rejected() {
        assert_eq!(
            preview_move_segment(&definition(), 99, 0.0, None, 8.0),
            Err(RoutingError::InvalidSegmentIndex)
        );
        assert_eq!(
            preview_move_segment(&definition(), 1, f64::NAN, None, 8.0),
            Err(RoutingError::Geometry(GeometryError::NonFinite(
                "route segment coordinate"
            )))
        );
    }
}
