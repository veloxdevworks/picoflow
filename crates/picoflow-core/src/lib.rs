//! Project, sequence, and timeline types.

mod ids;
mod project;
mod sequence;

pub use ids::{ActionId, ClipId, PhotoId};
pub use project::{
    parse_project, validate_action, validate_key, validate_mouse_move, Action, ActionKind, Clip,
    HidProfile, Modifier, MouseButton, MouseOp, Photo, Point, Project, RunMode, Target,
    DEFAULT_BUTTON_PIN, DEFAULT_KEY_HOLD_MS, DEFAULT_SETTLE_MS, DEFAULT_TAP_HOLD_MS,
    MIN_SWIPE_DURATION_MS, SCHEMA_VERSION,
};
pub use sequence::{parse_sequence, EventKind, Sequence, SequenceEvent};

/// Errors from parse, version checks, and action validation.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("unsupported schema version {found} (expected {expected})")]
    UnsupportedVersion { found: u32, expected: u32 },
    #[error("{0}")]
    InvalidAction(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Error {
    pub fn invalid_action(message: impl Into<String>) -> Self {
        Self::InvalidAction(message.into())
    }
}

pub fn ensure_version(version: u32) -> Result<(), Error> {
    if version != SCHEMA_VERSION {
        Err(Error::UnsupportedVersion {
            found: version,
            expected: SCHEMA_VERSION,
        })
    } else {
        Ok(())
    }
}
