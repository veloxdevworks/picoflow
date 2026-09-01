//! Project, sequence, and timeline types.

mod export;
mod ids;
mod project;
mod sequence;
mod timeline;

pub use export::to_sequence;
pub use ids::{ActionId, ClipId, PhotoId};
pub use project::{
    parse_project, validate_action, validate_key, validate_mouse_move, validate_swipe,
    validate_tap, Action, ActionKind, Clip, HidProfile, Modifier, MouseButton, MouseOp, Photo,
    Point, Project, RunMode, Target, DEFAULT_BUTTON_PIN, DEFAULT_KEY_HOLD_MS, DEFAULT_SETTLE_MS,
    DEFAULT_TAP_HOLD_MS, MIN_SWIPE_DURATION_MS, PROJECT_SCHEMA_VERSION,
};
pub use sequence::{parse_sequence, EventKind, Sequence, SequenceEvent, SEQUENCE_SCHEMA_VERSION};
pub use timeline::{
    clip_at, clip_end_ms, insert_wait, pack_clips, reorder_clips, ripple_clip, total_duration_ms,
    upcoming_keyframe, DEFAULT_CLIP_DURATION_MS, MIN_CLIP_DURATION_MS,
};

/// Errors from parse, version checks, action validation, and timeline mutations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("unsupported schema version {found} (expected {expected})")]
    UnsupportedVersion { found: u32, expected: u32 },
    #[error("{0}")]
    InvalidAction(String),
    #[error("clip {0} not found")]
    ClipNotFound(String),
    #[error("{0}")]
    InvalidTimeline(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Error {
    pub fn invalid_action(message: impl Into<String>) -> Self {
        Self::InvalidAction(message.into())
    }

    pub fn invalid_timeline(message: impl Into<String>) -> Self {
        Self::InvalidTimeline(message.into())
    }

    pub fn clip_not_found(id: impl ToString) -> Self {
        Self::ClipNotFound(id.to_string())
    }
}

pub fn ensure_version(version: u32, expected: u32) -> Result<(), Error> {
    if version != expected {
        Err(Error::UnsupportedVersion {
            found: version,
            expected,
        })
    } else {
        Ok(())
    }
}
