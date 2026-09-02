use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::{ActionId, ClipId, PhotoId};
use crate::{ensure_version, Error};

pub const PROJECT_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_SETTLE_MS: u32 = 1200;
pub const DEFAULT_BUTTON_PIN: &str = "GP15";
pub const DEFAULT_TAP_HOLD_MS: u32 = 60;
pub const DEFAULT_KEY_HOLD_MS: u32 = 50;
pub const MIN_SWIPE_DURATION_MS: u32 = 16;
/// Default tablet surface in pixels. Omitted `target.width`/`height` load as this.
pub const DEFAULT_TARGET_WIDTH: u32 = 1920;
pub const DEFAULT_TARGET_HEIGHT: u32 = 1080;

pub(crate) fn default_tap_hold_ms() -> u32 {
    DEFAULT_TAP_HOLD_MS
}

pub(crate) fn default_key_hold_ms() -> u32 {
    DEFAULT_KEY_HOLD_MS
}

pub(crate) fn default_button_pin() -> String {
    DEFAULT_BUTTON_PIN.to_string()
}

pub(crate) fn default_settle_ms() -> u32 {
    DEFAULT_SETTLE_MS
}

pub(crate) fn default_target_width() -> u32 {
    DEFAULT_TARGET_WIDTH
}

pub(crate) fn default_target_height() -> u32 {
    DEFAULT_TARGET_HEIGHT
}

// USB HID composite profile. Additive; serde rename_all keeps new variants snake_case.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[non_exhaustive]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum HidProfile {
    #[default]
    AbsoluteMouseKeyboard,
    DigitizerKeyboard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum RunMode {
    #[default]
    Auto,
    Button,
    Serial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum Modifier {
    Ctrl,
    Shift,
    Alt,
    Gui,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum MouseOp {
    Down,
    Up,
    Click,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Target {
    #[serde(default)]
    pub hid_profile: HidProfile,
    #[serde(default)]
    pub run_mode: RunMode,
    #[serde(default = "default_settle_ms")]
    pub settle_ms: u32,
    #[serde(default = "default_button_pin")]
    pub button_pin: String,
    #[serde(default = "default_target_width")]
    pub width: u32,
    #[serde(default = "default_target_height")]
    pub height: u32,
}

impl Default for Target {
    fn default() -> Self {
        Self {
            hid_profile: HidProfile::default(),
            run_mode: RunMode::default(),
            settle_ms: DEFAULT_SETTLE_MS,
            button_pin: default_button_pin(),
            width: DEFAULT_TARGET_WIDTH,
            height: DEFAULT_TARGET_HEIGHT,
        }
    }
}

impl Target {
    /// Positive tablet pixels, falling back to 1920×1080 if a value is 0.
    pub fn tablet_size(&self) -> (u32, u32) {
        (
            if self.width > 0 {
                self.width
            } else {
                DEFAULT_TARGET_WIDTH
            },
            if self.height > 0 {
                self.height
            } else {
                DEFAULT_TARGET_HEIGHT
            },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Photo {
    pub id: PhotoId,
    pub raw_path: String,
    pub warped_path: Option<String>,
    pub corners: Option<[Point; 4]>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detect_confidence: Option<f64>,
    pub normalized: bool,
    pub width: u32,
    pub height: u32,
    pub warped_width: Option<u32>,
    pub warped_height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Clip {
    pub id: ClipId,
    pub photo_id: PhotoId,
    pub start_ms: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Action {
    pub id: ActionId,
    pub at_ms: u32,
    #[serde(flatten)]
    pub kind: ActionKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub enum ActionKind {
    Tap {
        x: f64,
        y: f64,
        #[serde(default = "default_tap_hold_ms")]
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
        #[serde(default = "default_key_hold_ms")]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated.ts")]
pub struct Project {
    pub version: u32,
    pub name: String,
    pub target: Target,
    pub photos: Vec<Photo>,
    pub clips: Vec<Clip>,
    pub actions: Vec<Action>,
}

pub fn parse_project(json: &str) -> Result<Project, Error> {
    let project: Project = serde_json::from_str(json)?;
    ensure_version(project.version, PROJECT_SCHEMA_VERSION)?;
    project.validate_actions()?;
    Ok(project)
}

pub fn validate_action(action: &Action) -> Result<(), Error> {
    action.kind.validate()
}

impl ActionKind {
    pub fn validate(&self) -> Result<(), Error> {
        match self {
            ActionKind::Tap { x, y, .. } => validate_tap(*x, *y),
            ActionKind::Swipe {
                x0,
                y0,
                x1,
                y1,
                duration_ms,
            } => validate_swipe(*x0, *y0, *x1, *y1, *duration_ms),
            ActionKind::Key { keycode, chars, .. } => {
                validate_key(keycode.as_deref(), chars.as_deref())
            }
            ActionKind::MouseMove { x, y, dx, dy } => validate_mouse_move(*x, *y, *dx, *dy),
            ActionKind::MouseButton { .. } | ActionKind::Wait { .. } => Ok(()),
        }
    }
}

pub fn validate_tap(x: f64, y: f64) -> Result<(), Error> {
    validate_unit_coords(x, y, "tap")
}

pub fn validate_swipe(x0: f64, y0: f64, x1: f64, y1: f64, duration_ms: u32) -> Result<(), Error> {
    validate_unit_coords(x0, y0, "swipe")?;
    validate_unit_coords(x1, y1, "swipe")?;
    if duration_ms < MIN_SWIPE_DURATION_MS {
        return Err(Error::invalid_action(format!(
            "swipe duration must be at least {MIN_SWIPE_DURATION_MS} ms"
        )));
    }
    Ok(())
}

pub fn validate_key(keycode: Option<&str>, chars: Option<&str>) -> Result<(), Error> {
    match (keycode, chars) {
        (Some(code), None) if !code.is_empty() => Ok(()),
        (None, Some(text)) if !text.is_empty() => Ok(()),
        _ => Err(Error::invalid_action(
            "key action must have exactly one of keycode or chars",
        )),
    }
}

pub fn validate_mouse_move(
    x: Option<f64>,
    y: Option<f64>,
    dx: Option<i32>,
    dy: Option<i32>,
) -> Result<(), Error> {
    match (x, y, dx, dy) {
        (Some(x), Some(y), None, None) => validate_unit_coords(x, y, "mouse_move"),
        (None, None, Some(_), Some(_)) => Ok(()),
        _ => Err(Error::invalid_action(
            "mouse_move action must have exactly one of {x,y} or {dx,dy}",
        )),
    }
}

pub(crate) fn validate_unit_coords(x: f64, y: f64, what: &str) -> Result<(), Error> {
    if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y) {
        Ok(())
    } else {
        Err(Error::invalid_action(format!(
            "{what} coordinates must be in [0, 1]"
        )))
    }
}

impl Project {
    pub fn validate_actions(&self) -> Result<(), Error> {
        for action in &self.actions {
            validate_action(action)?;
        }
        Ok(())
    }
}
