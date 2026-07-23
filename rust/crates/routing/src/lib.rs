use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
    fmt,
};

use homelab_geometry::{GeometryError, Point, Rect, Segment, Side};
use serde::{Deserialize, Serialize};

const MIN_LANE_OFFSET: f64 = 0.0;
pub const DEFAULT_ROUTING_GRID: f64 = 12.0;
pub const MIN_ROUTING_MARGIN: f64 = 96.0;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObstacleRouteResult {
    pub route: RoutedPath,
    pub used_fallback: bool,
    pub warning: Option<RouteWarning>,
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
    overlap_penalty: u32,
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
    overlap_penalty: u32,
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
    let route_coordinates = std::iter::once(request.definition.source)
        .chain(std::iter::once(request.definition.target))
        .chain(request.definition.manual_bends.iter().copied())
        .collect::<Vec<_>>();
    let bounds = search_bounds(&route_coordinates, request.definition.lane_offset);
    let obstacles = request
        .obstacles
        .iter()
        .filter(|obstacle| bounds.intersects(obstacle.bounds))
        .cloned()
        .collect::<Vec<_>>();
    let source_obstacle = obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.source_item_id);
    let target_obstacle = obstacles
        .iter()
        .find(|obstacle| obstacle.item_id == request.target_item_id);
    let source_exit = obstacle_portal(
        request.definition.source,
        request.definition.source_side,
        source_obstacle,
        request,
        &obstacles,
    );
    let target_entry = obstacle_portal(
        request.definition.target,
        request.definition.target_side,
        target_obstacle,
        request,
        &obstacles,
    );
    let anchors = request
        .definition
        .manual_bends
        .iter()
        .map(|anchor| resolve_covered_anchor(*anchor, &obstacles, request))
        .collect::<Vec<_>>();

    let Some(graph_path) = find_visibility_path(
        source_exit,
        target_entry,
        &anchors,
        &obstacles,
        &request.reserved_segments,
        request,
        bounds,
    ) else {
        return fallback_route(request);
    };

    let protected = std::iter::once(source_exit)
        .chain(std::iter::once(target_entry))
        .chain(anchors.iter().copied())
        .collect::<Vec<_>>();
    let points = simplify_protected(
        std::iter::once(request.definition.source)
            .chain(graph_path)
            .chain(std::iter::once(request.definition.target))
            .collect(),
        &protected,
    );
    if route_intersects_obstacles(
        &points,
        &obstacles,
        &request.source_item_id,
        &request.target_item_id,
    ) {
        return fallback_route(request);
    }

    let mut search_from = 0;
    let mut manual_anchor_point_indexes = Vec::with_capacity(anchors.len());
    for anchor in anchors {
        let Some(index) = points
            .iter()
            .enumerate()
            .skip(search_from)
            .find_map(|(index, point)| points_equal(*point, anchor).then_some(index))
        else {
            return fallback_route(request);
        };
        manual_anchor_point_indexes
            .push(u16::try_from(index).map_err(|_| RoutingError::InvalidSegmentIndex)?);
        search_from = index + 1;
    }

    Ok(ObstacleRouteResult {
        route: RoutedPath {
            connection_id: request.definition.connection_id,
            points,
            manual_anchor_point_indexes,
        },
        used_fallback: false,
        warning: None,
    })
}

fn validate_obstacle_request(request: &ObstacleRouteRequest) -> Result<(), RoutingError> {
    request.definition.validate()?;
    if request.source_item_id.trim().is_empty() || request.target_item_id.trim().is_empty() {
        return Err(RoutingError::EmptyItemId);
    }
    validate_optional_grid(request.snap_to_grid.then_some(request.grid_size))?;
    let mut ids = request
        .obstacles
        .iter()
        .map(|obstacle| obstacle.item_id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    if ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(RoutingError::DuplicateObstacleId);
    }
    for obstacle in &request.obstacles {
        if obstacle.item_id.trim().is_empty() {
            return Err(RoutingError::EmptyItemId);
        }
        obstacle.bounds.validate()?;
    }
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

fn fallback_route(request: &ObstacleRouteRequest) -> Result<ObstacleRouteResult, RoutingError> {
    let route = request
        .previous_valid_route
        .clone()
        .map_or_else(|| build_route(&request.definition), Ok)?;
    Ok(ObstacleRouteResult {
        route,
        used_fallback: true,
        warning: Some(RouteWarning::SearchExhausted),
    })
}

fn search_bounds(points: &[Point], lane_offset: f64) -> SearchBounds {
    let margin = MIN_ROUTING_MARGIN.max(lane_offset * 3.0);
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
    match side {
        Side::Left => Point {
            x: snap_before_if(bounds.x, request),
            y: point.y,
        },
        Side::Right => Point {
            x: snap_after_if(bounds.right(), request),
            y: point.y,
        },
        Side::Top => Point {
            x: point.x,
            y: snap_before_if(bounds.y, request),
        },
        Side::Bottom => Point {
            x: point.x,
            y: snap_after_if(bounds.bottom(), request),
        },
    }
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
            overlap_penalty: 0,
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

    while let Some(current) = queue.pop() {
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
            let next_key = SearchKey {
                node_id: edge.to,
                direction: edge.direction,
                phase: advance_phase(node, current.key.phase, anchors),
            };
            let candidate = SearchBest {
                cost: SearchCost {
                    distance: current.cost.distance + edge.distance,
                    bends: current.cost.bends + u32::from(current.key.direction != edge.direction),
                    overlap_penalty: current.cost.overlap_penalty + edge.overlap_penalty,
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
    let overlap_penalty = reserved_segments
        .iter()
        .filter(|reserved| segments_have_collinear_conflict(candidate, **reserved, separation))
        .count() as u32;
    let edge = GraphEdge {
        to: second_id,
        direction,
        distance: manhattan(first, second),
        overlap_penalty,
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
    let first_orientation = orientation(first.start, first.end);
    let second_orientation = orientation(second.start, second.end);
    if first_orientation.is_none() || first_orientation != second_orientation {
        return false;
    }
    match first_orientation {
        Some(Orientation::Horizontal) => {
            (first.start.y - second.start.y).abs() < separation
                && ranges_overlap_beyond_point(
                    first.start.x,
                    first.end.x,
                    second.start.x,
                    second.end.x,
                )
        }
        Some(Orientation::Vertical) => {
            (first.start.x - second.start.x).abs() < separation
                && ranges_overlap_beyond_point(
                    first.start.y,
                    first.end.y,
                    second.start.y,
                    second.end.y,
                )
        }
        None => false,
    }
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
        .distance
        .total_cmp(&second.cost.distance)
        .then_with(|| first.cost.bends.cmp(&second.cost.bends))
        .then_with(|| first.cost.overlap_penalty.cmp(&second.cost.overlap_penalty))
        .then_with(|| first.lexical_path.cmp(&second.lexical_path))
}

fn side_direction(side: Side) -> SearchDirection {
    match side {
        Side::Left | Side::Right => SearchDirection::Horizontal,
        Side::Top | Side::Bottom => SearchDirection::Vertical,
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
        let mut points = vec![definition.source, source_exit];
        if source_exit.x != target_entry.x && source_exit.y != target_entry.y {
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

pub fn preview_insert_manual_bend(
    definition: &RouteDefinition,
    segment_index: u16,
    pointer: Point,
    snap_grid: Option<f64>,
) -> Result<RouteEdit, RoutingError> {
    pointer.validate()?;
    validate_optional_grid(snap_grid)?;
    let route = build_route(definition)?;
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
    definition.validate()?;
    if !coordinate.is_finite() {
        return Err(RoutingError::Geometry(GeometryError::NonFinite(
            "route segment coordinate",
        )));
    }
    validate_optional_grid(snap_grid)?;
    validate_snap_threshold(endpoint_snap_threshold)?;
    let route = build_route(definition)?;
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
            if orientation(before, previous) == orientation(previous, point) {
                let previous_index = result.len() - 1;
                result[previous_index] = point;
                continue;
            }
        }
        result.push(point);
    }
    result
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
            source_item_id: "server:1".to_owned(),
            target_item_id: "patchPanel:1".to_owned(),
            obstacles: Vec::new(),
            reserved_segments: Vec::new(),
            snap_to_grid: true,
            grid_size: DEFAULT_ROUTING_GRID,
            previous_valid_route: None,
        }
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
                .any(|point| point.y == 12.0 || point.y == 132.0)
        );
        assert!(result.route.points.windows(2).all(|pair| {
            !segment_crosses_obstacle_interior(pair[0], pair[1], request.obstacles[0].bounds)
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
        assert_eq!(result.route.points[1], Point { x: 112.0, y: 50.0 });
        assert_eq!(
            result.route.points[result.route.points.len() - 2],
            Point { x: 350.0, y: 312.0 }
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

        assert!(result.used_fallback);
        assert_eq!(result.warning, Some(RouteWarning::SearchExhausted));
        assert_eq!(result.route, previous);
        assert_orthogonal(&result.route.points);
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
