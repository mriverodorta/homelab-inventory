use std::fmt;

use serde::{Deserialize, Serialize};

pub const MAX_CANVAS_COORDINATE: f64 = 16_777_216.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GeometryError {
    NonFinite(&'static str),
    OutOfRange(&'static str),
    NegativeDimension(&'static str),
    EmptyIdentifier(&'static str),
    DiagonalSegment,
}

impl fmt::Display for GeometryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinite(field) => write!(formatter, "{field} must be finite."),
            Self::OutOfRange(field) => write!(formatter, "{field} exceeds canvas bounds."),
            Self::NegativeDimension(field) => write!(formatter, "{field} must not be negative."),
            Self::EmptyIdentifier(field) => write!(formatter, "{field} must not be empty."),
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
}
