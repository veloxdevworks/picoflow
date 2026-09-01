use serde::Serialize;
use std::io;

/// IPC error payload: `{ "code": string, "message": string }`.
#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[error("{message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

/// Stable command error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Io,
    NotFound,
    InvalidProject,
    UnsupportedImage,
    PathNotAllowed,
    VolumeNotWritable,
    Uf2Checksum,
    FlashTimeout,
    NotPicoflow,
    HidMismatch,
    InvalidAction,
    Canceled,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn invalid_project(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidProject, message)
    }

    pub fn unsupported_image(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::UnsupportedImage, message)
    }

    pub fn path_not_allowed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::PathNotAllowed, message)
    }

    pub fn volume_not_writable(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::VolumeNotWritable, message)
    }

    pub fn uf2_checksum(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Uf2Checksum, message)
    }

    pub fn flash_timeout(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::FlashTimeout, message)
    }

    pub fn not_picoflow(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotPicoflow, message)
    }

    pub fn hid_mismatch(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::HidMismatch, message)
    }

    pub fn invalid_action(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidAction, message)
    }

    pub fn canceled(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Canceled, message)
    }
}

impl From<io::Error> for AppError {
    fn from(err: io::Error) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => Self::not_found(err.to_string()),
            _ => Self::io(err.to_string()),
        }
    }
}

impl From<picoflow_core::Error> for AppError {
    fn from(err: picoflow_core::Error) -> Self {
        match err {
            picoflow_core::Error::ClipNotFound(id) => {
                Self::not_found(format!("clip {id} not found"))
            }
            picoflow_core::Error::InvalidAction(message) => Self::invalid_action(message),
            other => Self::invalid_project(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_message() {
        let err = AppError::canceled("user closed the dialog");
        let value = serde_json::to_value(&err).expect("serialize AppError");
        assert_eq!(value["code"], "canceled");
        assert_eq!(value["message"], "user closed the dialog");
    }

    #[test]
    fn maps_core_clip_not_found() {
        let err = AppError::from(picoflow_core::Error::ClipNotFound("missing".into()));
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn maps_core_timeline_to_invalid_project() {
        let err = AppError::from(picoflow_core::Error::invalid_timeline("bad reorder"));
        assert_eq!(err.code, ErrorCode::InvalidProject);
    }
}
