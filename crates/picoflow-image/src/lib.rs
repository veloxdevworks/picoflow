//! Image decode, detect, and warp.

mod decode;
mod detect;
mod exif;
mod heic;
mod warp;

pub use decode::{decode_path, save_oriented, OrientedImage, SourceFormat};
pub use detect::{detect_screen_quad, DetectResult, DETECT_CONFIDENCE_THRESHOLD};
pub use heic::{is_heic_extension, looks_like_heic};
pub use warp::{dest_size, dest_size_for_target, warp_quad, warp_quad_to, MAX_WARP_LONG_EDGE};

use serde::{Deserialize, Serialize};

/// Pixel coordinate in oriented-image space.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn dist(self, other: Self) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }
}

/// Errors from decode, HEIC conversion, and warp.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    UnsupportedImage(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Error {
    pub fn unsupported_image(message: impl Into<String>) -> Self {
        Self::UnsupportedImage(message.into())
    }
}

pub(crate) fn map_image_err(err: image::ImageError) -> Error {
    Error::from(err)
}

impl From<image::ImageError> for Error {
    fn from(err: image::ImageError) -> Self {
        match err {
            image::ImageError::IoError(e) => Error::Io(e),
            other => Error::unsupported_image(other.to_string()),
        }
    }
}
