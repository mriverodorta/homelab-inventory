use std::fmt;

use homelab_geometry::{GeometryError, Point, Side};
use serde::{Deserialize, Serialize};

const MIN_LANE_OFFSET: f64 = 0.0;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Orientation {
    Horizontal,
    Vertical,
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
