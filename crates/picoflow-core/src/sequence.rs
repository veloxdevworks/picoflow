use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::project::{
    validate_key, validate_mouse_move, validate_unit_coords, HidProfile, Modifier, MouseButton,
    MouseOp, RunMode, MIN_SWIPE_DURATION_MS,
};
use crate::{ensure_version, Error};

/// On-device `sequence.json` v1 (snake_case).
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
        keycode: Option<String>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        chars: Option<String>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Vec::is_empty")]
        modifiers: Vec<Modifier>,
        #[serde(default = "crate::project::default_key_hold_ms")]
        hold_ms: u32,
    },
    MouseMove {
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        x: Option<f64>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        y: Option<f64>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        dx: Option<i32>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
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
    ensure_version(sequence.version)?;
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
            EventKind::Tap { x, y, .. } => validate_unit_coords(*x, *y, "tap"),
            EventKind::Swipe {
                x0,
                y0,
                x1,
                y1,
                duration_ms,
            } => {
                validate_unit_coords(*x0, *y0, "swipe")?;
                validate_unit_coords(*x1, *y1, "swipe")?;
                if *duration_ms < MIN_SWIPE_DURATION_MS {
                    return Err(Error::invalid_action(format!(
                        "swipe duration must be at least {MIN_SWIPE_DURATION_MS} ms"
                    )));
                }
                Ok(())
            }
            EventKind::Key { keycode, chars, .. } => {
                validate_key(keycode.as_deref(), chars.as_deref())
            }
            EventKind::MouseMove { x, y, dx, dy } => validate_mouse_move(*x, *y, *dx, *dy),
            EventKind::MouseButton { .. } => Ok(()),
            EventKind::Wait { .. } => Ok(()),
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
