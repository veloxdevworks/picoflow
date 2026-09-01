use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::project::{
    validate_key, validate_mouse_move, validate_swipe, validate_tap, HidProfile, Modifier,
    MouseButton, MouseOp, RunMode,
};
use crate::{ensure_version, Error};

pub const SEQUENCE_SCHEMA_VERSION: u32 = 1;

// On-device `sequence.json` v1 (snake_case).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Sequence {
    pub version: u32,
    #[serde(default)]
    pub run_mode: RunMode,
    #[serde(default = "crate::project::default_settle_ms")]
    pub settle_ms: u32,
    #[serde(default)]
    pub hid_profile: HidProfile,
    #[serde(default = "crate::project::default_button_pin")]
    pub button_pin: String,
    pub events: Vec<SequenceEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct SequenceEvent {
    pub at_ms: u32,
    #[serde(flatten)]
    pub kind: EventKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum EventKind {
    Tap {
        x: f64,
        y: f64,
        #[serde(default = "crate::project::default_tap_hold_ms")]
        hold_ms: u32,
    },
    Swipe {
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
        duration_ms: u32,
    },
    Key {
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        keycode: Option<String>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        chars: Option<String>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        modifiers: Option<Vec<Modifier>>,
        #[serde(default = "crate::project::default_key_hold_ms")]
        hold_ms: u32,
    },
    MouseMove {
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        x: Option<f64>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        y: Option<f64>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        dx: Option<i32>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        dy: Option<i32>,
    },
    MouseButton {
        button: MouseButton,
        op: MouseOp,
    },
    Wait {
        duration_ms: u32,
    },
}

pub fn parse_sequence(json: &str) -> Result<Sequence, Error> {
    let sequence: Sequence = serde_json::from_str(json)?;
    ensure_version(sequence.version, SEQUENCE_SCHEMA_VERSION)?;
    sequence.validate_events()?;
    Ok(sequence)
}

impl SequenceEvent {
    pub fn validate(&self) -> Result<(), Error> {
        self.kind.validate()
    }
}

impl EventKind {
    pub fn validate(&self) -> Result<(), Error> {
        match self {
            EventKind::Tap { x, y, .. } => validate_tap(*x, *y),
            EventKind::Swipe {
                x0,
                y0,
                x1,
                y1,
                duration_ms,
            } => validate_swipe(*x0, *y0, *x1, *y1, *duration_ms),
            EventKind::Key { keycode, chars, .. } => {
                validate_key(keycode.as_deref(), chars.as_deref())
            }
            EventKind::MouseMove { x, y, dx, dy } => validate_mouse_move(*x, *y, *dx, *dy),
            EventKind::MouseButton { .. } | EventKind::Wait { .. } => Ok(()),
        }
    }
}

impl Sequence {
    pub fn validate_events(&self) -> Result<(), Error> {
        for event in &self.events {
            event.validate()?;
        }
        Ok(())
    }
}
