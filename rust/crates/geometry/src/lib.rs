use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use serde::{Deserialize, Serialize};

pub const MAX_CANVAS_COORDINATE: f64 = 16_777_216.0;
pub const SPATIAL_BUCKET_SIZE: f64 = 192.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GeometryError {
    NonFinite(&'static str),
    OutOfRange(&'static str),
    NegativeDimension(&'static str),
    NonPositive(&'static str),
    EmptyIdentifier(&'static str),
    UnknownIdentifier(&'static str),
    DuplicateIdentifier(&'static str),
    DiagonalSegment,
}

impl fmt::Display for GeometryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinite(field) => write!(formatter, "{field} must be finite."),
            Self::OutOfRange(field) => write!(formatter, "{field} exceeds canvas bounds."),
            Self::NegativeDimension(field) => write!(formatter, "{field} must not be negative."),
            Self::NonPositive(field) => write!(formatter, "{field} must be positive."),
            Self::EmptyIdentifier(field) => write!(formatter, "{field} must not be empty."),
            Self::UnknownIdentifier(field) => write!(formatter, "{field} does not exist."),
            Self::DuplicateIdentifier(field) => write!(formatter, "{field} must be unique."),
            Self::DiagonalSegment => {
                formatter.write_str("Segments must be horizontal or vertical.")
            }
        }
    }
}

impl std::error::Error for GeometryError {}

fn validate_coordinate(value: f64, field: &'static str) -> Result<(), GeometryError> {
    if !value.is_finite() {
        return Err(GeometryError::NonFinite(field));
    }
    if value.abs() > MAX_CANVAS_COORDINATE {
        return Err(GeometryError::OutOfRange(field));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn validate(self) -> Result<Self, GeometryError> {
        validate_coordinate(self.x, "point.x")?;
        validate_coordinate(self.y, "point.y")?;
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn validate(self) -> Result<Self, GeometryError> {
        validate_coordinate(self.x, "rect.x")?;
        validate_coordinate(self.y, "rect.y")?;
        validate_coordinate(self.width, "rect.width")?;
        validate_coordinate(self.height, "rect.height")?;
        if self.width < 0.0 {
            return Err(GeometryError::NegativeDimension("rect.width"));
        }
        if self.height < 0.0 {
            return Err(GeometryError::NegativeDimension("rect.height"));
        }
        validate_coordinate(self.right(), "rect.right")?;
        validate_coordinate(self.bottom(), "rect.bottom")?;
        Ok(self)
    }

    #[must_use]
    pub fn from_corners(first: Point, second: Point) -> Self {
        let left = first.x.min(second.x);
        let top = first.y.min(second.y);
        Self {
            x: left,
            y: top,
            width: first.x.max(second.x) - left,
            height: first.y.max(second.y) - top,
        }
    }

    #[must_use]
    pub fn right(self) -> f64 {
        self.x + self.width
    }

    #[must_use]
    pub fn bottom(self) -> f64 {
        self.y + self.height
    }

    #[must_use]
    pub fn overlaps(self, other: Self) -> bool {
        self.x < other.right()
            && self.right() > other.x
            && self.y < other.bottom()
            && self.bottom() > other.y
    }

    #[must_use]
    pub fn inflate(self, clearance: f64) -> Self {
        Self {
            x: self.x - clearance,
            y: self.y - clearance,
            width: self.width + clearance * 2.0,
            height: self.height + clearance * 2.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentOrientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub start: Point,
    pub end: Point,
}

impl Segment {
    pub fn validate(self) -> Result<Self, GeometryError> {
        self.start.validate()?;
        self.end.validate()?;
        self.orientation()?;
        Ok(self)
    }

    pub fn orientation(self) -> Result<SegmentOrientation, GeometryError> {
        if self.start.y == self.end.y {
            Ok(SegmentOrientation::Horizontal)
        } else if self.start.x == self.end.x {
            Ok(SegmentOrientation::Vertical)
        } else {
            Err(GeometryError::DiagonalSegment)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeometryNode {
    pub item_id: String,
    pub bounds: Rect,
}

impl GeometryNode {
    pub fn validate(&self) -> Result<(), GeometryError> {
        if self.item_id.trim().is_empty() {
            return Err(GeometryError::EmptyIdentifier("geometry node item_id"));
        }
        self.bounds.validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeometryHandle {
    pub key: String,
    pub item_id: String,
    pub point: Point,
    pub side: Side,
}

impl GeometryHandle {
    pub fn validate(&self) -> Result<(), GeometryError> {
        if self.key.trim().is_empty() {
            return Err(GeometryError::EmptyIdentifier("geometry handle key"));
        }
        if self.item_id.trim().is_empty() {
            return Err(GeometryError::EmptyIdentifier("geometry handle item_id"));
        }
        self.point.validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct SpatialIndex {
    rects: BTreeMap<String, Rect>,
    buckets: BTreeMap<(i32, i32), BTreeSet<String>>,
    memberships: BTreeMap<String, Vec<(i32, i32)>>,
}

impl SpatialIndex {
    #[must_use]
    pub fn len(&self) -> usize {
        self.rects.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rects.is_empty()
    }

    pub fn replace(&mut self, nodes: &[GeometryNode]) -> Result<(), GeometryError> {
        let mut replacement = Self::default();
        for node in nodes {
            if replacement.rects.contains_key(&node.item_id) {
                return Err(GeometryError::DuplicateIdentifier("geometry node item_id"));
            }
            replacement.upsert(node.clone())?;
        }
        *self = replacement;
        Ok(())
    }

    pub fn upsert(&mut self, node: GeometryNode) -> Result<(), GeometryError> {
        node.validate()?;
        self.remove(&node.item_id);
        let memberships = bucket_keys(node.bounds);
        for key in &memberships {
            self.buckets
                .entry(*key)
                .or_default()
                .insert(node.item_id.clone());
        }
        self.memberships.insert(node.item_id.clone(), memberships);
        self.rects.insert(node.item_id, node.bounds);
        Ok(())
    }

    pub fn remove(&mut self, item_id: &str) -> Option<Rect> {
        if let Some(memberships) = self.memberships.remove(item_id) {
            for key in memberships {
                if let Some(bucket) = self.buckets.get_mut(&key) {
                    bucket.remove(item_id);
                    if bucket.is_empty() {
                        self.buckets.remove(&key);
                    }
                }
            }
        }
        self.rects.remove(item_id)
    }

    #[must_use]
    pub fn rect(&self, item_id: &str) -> Option<Rect> {
        self.rects.get(item_id).copied()
    }

    #[must_use]
    pub fn overlapping_ids(&self, bounds: Rect, excluded: &BTreeSet<String>) -> Vec<String> {
        let mut candidates = BTreeSet::new();
        for key in bucket_keys(bounds) {
            if let Some(bucket) = self.buckets.get(&key) {
                candidates.extend(bucket.iter().cloned());
            }
        }
        candidates
            .into_iter()
            .filter(|item_id| !excluded.contains(item_id))
            .filter(|item_id| {
                self.rects
                    .get(item_id)
                    .is_some_and(|rect| rect.overlaps(bounds))
            })
            .collect()
    }

    pub fn check_group(&self, nodes: &[GeometryNode]) -> Result<Vec<String>, GeometryError> {
        let moved_ids: BTreeSet<_> = nodes.iter().map(|node| node.item_id.clone()).collect();
        if moved_ids.len() != nodes.len() {
            return Err(GeometryError::DuplicateIdentifier("group item_id"));
        }
        for node in nodes {
            node.validate()?;
        }

        let mut collisions = BTreeSet::new();
        for (index, node) in nodes.iter().enumerate() {
            collisions.extend(self.overlapping_ids(node.bounds, &moved_ids));
            for other in &nodes[index + 1..] {
                if node.bounds.overlaps(other.bounds) {
                    collisions.insert(node.item_id.clone());
                    collisions.insert(other.item_id.clone());
                }
            }
        }
        Ok(collisions.into_iter().collect())
    }

    pub fn nearest_valid(
        &self,
        item_id: &str,
        preferred: Rect,
        clearance: f64,
        step: f64,
        max_rings: u16,
    ) -> Result<Option<Rect>, GeometryError> {
        preferred.validate()?;
        validate_clearance(clearance)?;
        validate_step(step)?;
        let excluded = BTreeSet::from([item_id.to_owned()]);
        let valid = |rect: Rect| {
            let query = if clearance == 0.0 {
                rect
            } else {
                rect.inflate(clearance)
            };
            self.overlapping_ids(query, &excluded).is_empty()
        };
        if valid(preferred) {
            return Ok(Some(preferred));
        }

        for ring in 1..=max_rings {
            let ring_steps = i32::from(ring);
            let mut offsets = Vec::with_capacity((ring_steps * 8) as usize);
            for x_step in -ring_steps..=ring_steps {
                for y_step in [-ring_steps, ring_steps] {
                    offsets.push((x_step, y_step));
                }
            }
            for y_step in (-ring_steps + 1)..ring_steps {
                for x_step in [-ring_steps, ring_steps] {
                    offsets.push((x_step, y_step));
                }
            }
            offsets.sort_by_key(|(x, y)| (x * x + y * y, *y, *x));
            for (x_step, y_step) in offsets {
                let candidate = translated(
                    preferred,
                    f64::from(x_step) * step,
                    f64::from(y_step) * step,
                );
                candidate.validate()?;
                if valid(candidate) {
                    return Ok(Some(candidate));
                }
            }
        }
        Ok(None)
    }
}

fn validate_clearance(value: f64) -> Result<(), GeometryError> {
    validate_coordinate(value, "clearance")?;
    if value < 0.0 {
        return Err(GeometryError::NegativeDimension("clearance"));
    }
    Ok(())
}

fn validate_step(value: f64) -> Result<(), GeometryError> {
    validate_coordinate(value, "step")?;
    if value <= 0.0 {
        return Err(GeometryError::NonPositive("step"));
    }
    Ok(())
}

fn translated(rect: Rect, x: f64, y: f64) -> Rect {
    Rect {
        x: rect.x + x,
        y: rect.y + y,
        ..rect
    }
}

fn bucket_keys(rect: Rect) -> Vec<(i32, i32)> {
    let left = (rect.x / SPATIAL_BUCKET_SIZE).floor() as i32;
    let right = (rect.right() / SPATIAL_BUCKET_SIZE).floor() as i32;
    let top = (rect.y / SPATIAL_BUCKET_SIZE).floor() as i32;
    let bottom = (rect.bottom() / SPATIAL_BUCKET_SIZE).floor() as i32;
    let mut keys = Vec::with_capacity(((right - left + 1) * (bottom - top + 1)) as usize);
    for x in left..=right {
        for y in top..=bottom {
            keys.push((x, y));
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangles_normalize_from_corners() {
        let rect = Rect::from_corners(Point { x: 8.5, y: 10.0 }, Point { x: 2.0, y: 3.5 });
        assert_eq!(
            rect,
            Rect {
                x: 2.0,
                y: 3.5,
                width: 6.5,
                height: 6.5
            }
        );
    }

    #[test]
    fn touching_edges_do_not_overlap_but_positive_area_does() {
        let first = Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        let touching = Rect {
            x: 10.0,
            y: 0.0,
            width: 5.0,
            height: 5.0,
        };
        let overlapping = Rect {
            x: 9.5,
            y: 1.0,
            width: 5.0,
            height: 5.0,
        };
        assert!(!first.overlaps(touching));
        assert!(first.overlaps(overlapping));
    }

    #[test]
    fn invalid_numeric_values_are_rejected() {
        assert_eq!(
            Point {
                x: f64::NAN,
                y: 0.0
            }
            .validate(),
            Err(GeometryError::NonFinite("point.x"))
        );
        assert_eq!(
            Rect {
                x: 0.0,
                y: 0.0,
                width: -1.0,
                height: 2.0
            }
            .validate(),
            Err(GeometryError::NegativeDimension("rect.width"))
        );
        assert_eq!(
            Point {
                x: MAX_CANVAS_COORDINATE + 1.0,
                y: 0.0
            }
            .validate(),
            Err(GeometryError::OutOfRange("point.x"))
        );
    }

    #[test]
    fn segments_must_be_orthogonal() {
        let horizontal = Segment {
            start: Point { x: 0.0, y: 1.0 },
            end: Point { x: 4.0, y: 1.0 },
        };
        let diagonal = Segment {
            start: Point { x: 0.0, y: 0.0 },
            end: Point { x: 1.0, y: 1.0 },
        };
        assert_eq!(horizontal.orientation(), Ok(SegmentOrientation::Horizontal));
        assert_eq!(diagonal.orientation(), Err(GeometryError::DiagonalSegment));
    }

    fn node(item_id: &str, x: f64, y: f64, width: f64, height: f64) -> GeometryNode {
        GeometryNode {
            item_id: item_id.into(),
            bounds: Rect {
                x,
                y,
                width,
                height,
            },
        }
    }

    #[test]
    fn spatial_index_updates_and_returns_deterministic_collisions() {
        let mut index = SpatialIndex::default();
        index
            .upsert(node("server:2", 200.0, 0.0, 100.0, 100.0))
            .unwrap();
        index
            .upsert(node("server:1", 0.0, 0.0, 100.0, 100.0))
            .unwrap();
        assert_eq!(
            index.overlapping_ids(
                Rect {
                    x: 50.0,
                    y: 0.0,
                    width: 200.0,
                    height: 100.0
                },
                &BTreeSet::new(),
            ),
            vec!["server:1", "server:2"],
        );

        index
            .upsert(node("server:1", 400.0, 0.0, 100.0, 100.0))
            .unwrap();
        assert_eq!(
            index.overlapping_ids(
                Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 100.0
                },
                &BTreeSet::new(),
            ),
            Vec::<String>::new(),
        );
        assert!(index.remove("server:2").is_some());
        assert_eq!(index.len(), 1);
    }

    #[test]
    fn group_checks_exclude_moved_items_but_detect_internal_overlap() {
        let mut index = SpatialIndex::default();
        index
            .replace(&[
                node("server:1", 0.0, 0.0, 100.0, 100.0),
                node("server:2", 120.0, 0.0, 100.0, 100.0),
                node("server:3", 400.0, 0.0, 100.0, 100.0),
            ])
            .unwrap();

        assert!(
            index
                .check_group(&[
                    node("server:1", 200.0, 200.0, 100.0, 100.0),
                    node("server:2", 320.0, 200.0, 100.0, 100.0),
                ])
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            index
                .check_group(&[
                    node("server:1", 200.0, 200.0, 100.0, 100.0),
                    node("server:2", 250.0, 200.0, 100.0, 100.0),
                ])
                .unwrap(),
            vec!["server:1", "server:2"]
        );
    }

    #[test]
    fn nearest_valid_search_is_stable_and_respects_clearance() {
        let mut index = SpatialIndex::default();
        index
            .upsert(node("occupied", 0.0, 0.0, 100.0, 100.0))
            .unwrap();
        let preferred = Rect {
            x: 0.0,
            y: 0.0,
            width: 50.0,
            height: 50.0,
        };
        let result = index
            .nearest_valid("moving", preferred, 0.0, 24.0, 10)
            .unwrap();
        assert_eq!(
            result,
            Some(Rect {
                x: 0.0,
                y: -72.0,
                width: 50.0,
                height: 50.0
            })
        );
    }

    #[test]
    fn bucket_index_matches_brute_force_for_seeded_rectangles() {
        let mut seed = 0x5eed_u64;
        let mut index = SpatialIndex::default();
        let mut nodes = Vec::new();
        for id in 0..250 {
            seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            let x = ((seed >> 16) % 2_000) as f64 - 1_000.0;
            seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            let y = ((seed >> 16) % 2_000) as f64 - 1_000.0;
            nodes.push(node(
                &format!("node:{id}"),
                x,
                y,
                24.0 + f64::from(id % 5),
                30.0,
            ));
        }
        index.replace(&nodes).unwrap();

        for query_index in 0..1_000 {
            let query = Rect {
                x: f64::from((query_index * 37) % 2_000) - 1_000.0,
                y: f64::from((query_index * 53) % 2_000) - 1_000.0,
                width: 96.0,
                height: 72.0,
            };
            let actual = index.overlapping_ids(query, &BTreeSet::new());
            let expected: Vec<_> = nodes
                .iter()
                .filter(|node| node.bounds.overlaps(query))
                .map(|node| node.item_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            assert_eq!(actual, expected);
        }
    }
}
