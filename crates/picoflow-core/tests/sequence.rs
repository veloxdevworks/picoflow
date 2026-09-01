use picoflow_core::{
    parse_project, parse_sequence, validate_action, validate_key, validate_mouse_move, Action,
    ActionKind, Error, EventKind, SequenceEvent, PROJECT_SCHEMA_VERSION, SEQUENCE_SCHEMA_VERSION,
};
use serde_json::json;

const PROJECT_V1: &str = include_str!("fixtures/project_v1.json");
const SEQUENCE_V1: &str = include_str!("fixtures/sequence_v1.json");

fn assert_round_trip<T>(json: &str)
where
    T: serde::Serialize + serde::de::DeserializeOwned + std::fmt::Debug + PartialEq,
{
    let parsed: T = serde_json::from_str(json).expect("deserialize fixture");
    let serialized = serde_json::to_value(&parsed).expect("serialize");
    let original: serde_json::Value = serde_json::from_str(json).expect("parse fixture value");
    assert_eq!(serialized, original);
    let again: T = serde_json::from_value(serialized).expect("deserialize serialized");
    assert_eq!(parsed, again);
}

#[test]
fn project_v1_round_trip() {
    let project = parse_project(PROJECT_V1).expect("parse project v1");
    assert_eq!(project.version, 1);
    assert_eq!(project.target.button_pin, "GP15");
    project.validate_actions().expect("fixture actions valid");
    assert_round_trip::<picoflow_core::Project>(PROJECT_V1);
}

#[test]
fn sequence_v1_round_trip() {
    let sequence = parse_sequence(SEQUENCE_V1).expect("parse sequence v1");
    assert_eq!(sequence.version, 1);
    assert_eq!(sequence.button_pin, "GP15");
    sequence.validate_events().expect("fixture events valid");
    assert_round_trip::<picoflow_core::Sequence>(SEQUENCE_V1);
}

#[test]
fn unknown_project_version_refused() {
    let mut value: serde_json::Value = serde_json::from_str(PROJECT_V1).unwrap();
    value["version"] = json!(2);
    let err = parse_project(&value.to_string()).unwrap_err();
    assert!(matches!(
        err,
        Error::UnsupportedVersion {
            found: 2,
            expected: PROJECT_SCHEMA_VERSION
        }
    ));
}

#[test]
fn unknown_sequence_version_refused() {
    let mut value: serde_json::Value = serde_json::from_str(SEQUENCE_V1).unwrap();
    value["version"] = json!(2);
    let err = parse_sequence(&value.to_string()).unwrap_err();
    assert!(matches!(
        err,
        Error::UnsupportedVersion {
            found: 2,
            expected: SEQUENCE_SCHEMA_VERSION
        }
    ));
}

#[test]
fn unknown_fields_ignored_on_read() {
    let mut project: serde_json::Value = serde_json::from_str(PROJECT_V1).unwrap();
    project["extra"] = json!("ignored");
    project["photos"][0]["mystery"] = json!(true);
    project["actions"][0]["alsoUnknown"] = json!(1);
    parse_project(&project.to_string()).expect("unknown fields ignored");

    let mut sequence: serde_json::Value = serde_json::from_str(SEQUENCE_V1).unwrap();
    sequence["future_field"] = json!({ "ok": true });
    sequence["events"][0]["note"] = json!("ignored");
    parse_sequence(&sequence.to_string()).expect("unknown fields ignored");
}

#[test]
fn tap_hold_ms_defaults_to_60() {
    let action: Action = serde_json::from_value(json!({
        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "atMs": 100,
        "type": "tap",
        "x": 0.1,
        "y": 0.2
    }))
    .unwrap();
    match action.kind {
        ActionKind::Tap { hold_ms, .. } => assert_eq!(hold_ms, 60),
        other => panic!("expected tap, got {other:?}"),
    }
}

#[test]
fn key_hold_ms_defaults_to_50() {
    let event: SequenceEvent = serde_json::from_value(json!({
        "at_ms": 100,
        "type": "key",
        "chars": "ok"
    }))
    .unwrap();
    match event.kind {
        EventKind::Key { hold_ms, chars, .. } => {
            assert_eq!(hold_ms, 50);
            assert_eq!(chars.as_deref(), Some("ok"));
        }
        other => panic!("expected key, got {other:?}"),
    }
}

#[test]
fn keycode_is_string_not_int() {
    let err = serde_json::from_value::<Action>(json!({
        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "atMs": 100,
        "type": "key",
        "keycode": 40
    }))
    .unwrap_err();
    assert!(err.to_string().contains("string") || err.is_data());
}

#[test]
fn key_exactly_one_of_keycode_or_chars() {
    assert!(validate_key(Some("ENTER"), None).is_ok());
    assert!(validate_key(None, Some("ok")).is_ok());
    assert!(validate_key(Some("ENTER"), Some("ok")).is_err());
    assert!(validate_key(None, None).is_err());
    assert!(validate_key(Some(""), None).is_err());

    let both: Action = serde_json::from_value(json!({
        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "atMs": 1,
        "type": "key",
        "keycode": "ENTER",
        "chars": "ok"
    }))
    .unwrap();
    match &both.kind {
        ActionKind::Key { keycode, chars, .. } => {
            assert_eq!(keycode.as_deref(), Some("ENTER"));
            assert_eq!(chars.as_deref(), Some("ok"));
        }
        other => panic!("expected key, got {other:?}"),
    }
    assert!(matches!(
        validate_action(&both),
        Err(Error::InvalidAction(_))
    ));

    let neither: Action = serde_json::from_value(json!({
        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "atMs": 1,
        "type": "key"
    }))
    .unwrap();
    match &neither.kind {
        ActionKind::Key { keycode, chars, .. } => {
            assert!(keycode.is_none());
            assert!(chars.is_none());
        }
        other => panic!("expected key, got {other:?}"),
    }
    assert!(matches!(
        validate_action(&neither),
        Err(Error::InvalidAction(_))
    ));
}

#[test]
fn mouse_move_exactly_one_pair() {
    assert!(validate_mouse_move(Some(0.5), Some(0.5), None, None).is_ok());
    assert!(validate_mouse_move(None, None, Some(1), Some(-1)).is_ok());
    assert!(validate_mouse_move(None, None, None, None).is_err());
    assert!(validate_mouse_move(Some(0.5), Some(0.5), Some(1), Some(1)).is_err());
    assert!(validate_mouse_move(Some(0.5), None, None, None).is_err());
    assert!(validate_mouse_move(Some(0.5), None, Some(1), None).is_err());
    assert!(validate_mouse_move(Some(1.5), Some(0.5), None, None).is_err());
}

const ACTION_ID: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

fn parse_action(value: serde_json::Value) -> Action {
    serde_json::from_value(value).expect("deserialize action")
}

fn parse_event(value: serde_json::Value) -> SequenceEvent {
    serde_json::from_value(value).expect("deserialize sequence event")
}

#[test]
fn mouse_move_serde_keeps_raw_options() {
    let both = parse_action(json!({
        "id": ACTION_ID,
        "atMs": 1,
        "type": "mouse_move",
        "x": 0.5,
        "y": 0.5,
        "dx": 1,
        "dy": 1
    }));
    match &both.kind {
        ActionKind::MouseMove { x, y, dx, dy } => {
            assert_eq!(*x, Some(0.5));
            assert_eq!(*y, Some(0.5));
            assert_eq!(*dx, Some(1));
            assert_eq!(*dy, Some(1));
        }
        other => panic!("expected mouse_move, got {other:?}"),
    }
    assert!(matches!(
        validate_action(&both),
        Err(Error::InvalidAction(_))
    ));

    let neither = parse_action(json!({
        "id": ACTION_ID,
        "atMs": 1,
        "type": "mouse_move"
    }));
    match &neither.kind {
        ActionKind::MouseMove { x, y, dx, dy } => {
            assert!(x.is_none() && y.is_none() && dx.is_none() && dy.is_none());
        }
        other => panic!("expected mouse_move, got {other:?}"),
    }
    assert!(matches!(
        validate_action(&neither),
        Err(Error::InvalidAction(_))
    ));

    let dx_only = parse_action(json!({
        "id": ACTION_ID,
        "atMs": 1,
        "type": "mouse_move",
        "dx": 1
    }));
    match &dx_only.kind {
        ActionKind::MouseMove { x, y, dx, dy } => {
            assert!(x.is_none() && y.is_none());
            assert_eq!(*dx, Some(1));
            assert!(dy.is_none());
        }
        other => panic!("expected mouse_move, got {other:?}"),
    }
    assert!(matches!(
        validate_action(&dx_only),
        Err(Error::InvalidAction(_))
    ));

    let x_only = parse_action(json!({
        "id": ACTION_ID,
        "atMs": 1,
        "type": "mouse_move",
        "x": 0.5
    }));
    match &x_only.kind {
        ActionKind::MouseMove { x, y, dx, dy } => {
            assert_eq!(*x, Some(0.5));
            assert!(y.is_none() && dx.is_none() && dy.is_none());
        }
        other => panic!("expected mouse_move, got {other:?}"),
    }
    assert!(matches!(
        validate_action(&x_only),
        Err(Error::InvalidAction(_))
    ));

    let event = parse_event(json!({
        "at_ms": 1,
        "type": "mouse_move",
        "dx": 1
    }));
    match &event.kind {
        EventKind::MouseMove { x, y, dx, dy } => {
            assert!(x.is_none() && y.is_none());
            assert_eq!(*dx, Some(1));
            assert!(dy.is_none());
        }
        other => panic!("expected mouse_move, got {other:?}"),
    }
    assert!(matches!(event.validate(), Err(Error::InvalidAction(_))));
}

#[test]
fn parse_rejects_invalid_exclusive_unions() {
    let mut project: serde_json::Value = serde_json::from_str(PROJECT_V1).unwrap();
    project["actions"] = json!([{
        "id": ACTION_ID,
        "atMs": 1,
        "type": "key"
    }]);
    assert!(matches!(
        parse_project(&project.to_string()),
        Err(Error::InvalidAction(_))
    ));

    let mut sequence: serde_json::Value = serde_json::from_str(SEQUENCE_V1).unwrap();
    sequence["events"] = json!([{
        "at_ms": 1,
        "type": "mouse_move",
        "x": 0.5
    }]);
    assert!(matches!(
        parse_sequence(&sequence.to_string()),
        Err(Error::InvalidAction(_))
    ));
}

#[test]
fn wait_duration_zero_is_valid() {
    let action: Action = serde_json::from_value(json!({
        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "atMs": 0,
        "type": "wait",
        "durationMs": 0
    }))
    .unwrap();
    validate_action(&action).expect("wait 0 is valid");
}
