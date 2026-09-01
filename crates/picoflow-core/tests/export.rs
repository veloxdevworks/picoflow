use picoflow_core::{
    parse_project, parse_sequence, to_sequence, Action, ActionKind, Error, EventKind, Project,
    Sequence,
};
use serde_json::json;

const PROJECT_V1: &str = include_str!("fixtures/project_v1.json");
const SEQUENCE_V1: &str = include_str!("fixtures/sequence_v1.json");

#[test]
fn to_sequence_matches_sequence_v1_golden() {
    let project = parse_project(PROJECT_V1).expect("parse project v1");
    let sequence = to_sequence(&project).expect("export project v1");
    let expected = parse_sequence(SEQUENCE_V1).expect("parse sequence v1");
    assert_eq!(sequence, expected);

    let exported = serde_json::to_value(&sequence).expect("serialize export");
    let golden: serde_json::Value = serde_json::from_str(SEQUENCE_V1).expect("parse golden json");
    assert_eq!(exported, golden);
}

#[test]
fn to_sequence_copies_target_and_sorts_by_at_ms() {
    let mut project = parse_project(PROJECT_V1).expect("parse project v1");
    project.actions.reverse();
    assert!(
        project.actions[0].at_ms > project.actions[1].at_ms,
        "fixture should be unsorted after reverse"
    );

    let sequence = to_sequence(&project).expect("export reversed actions");
    let times: Vec<u32> = sequence.events.iter().map(|event| event.at_ms).collect();
    let mut sorted = times.clone();
    sorted.sort_unstable();
    assert_eq!(times, sorted);
    assert_eq!(sequence.run_mode, project.target.run_mode);
    assert_eq!(sequence.settle_ms, project.target.settle_ms);
    assert_eq!(sequence.hid_profile, project.target.hid_profile);
    assert_eq!(sequence.button_pin, project.target.button_pin);
    assert_eq!(sequence.events.len(), project.actions.len());
}

#[test]
fn to_sequence_keeps_wait_and_omits_clip_photo_fields() {
    let project = parse_project(PROJECT_V1).expect("parse project v1");
    let sequence = to_sequence(&project).expect("export");
    assert!(sequence
        .events
        .iter()
        .any(|event| matches!(event.kind, EventKind::Wait { duration_ms: 300 })));

    let value = serde_json::to_value(&sequence).expect("serialize");
    let obj = value.as_object().expect("sequence object");
    assert!(!obj.contains_key("clips"));
    assert!(!obj.contains_key("photos"));
    assert!(!obj.contains_key("name"));
    for event in value["events"].as_array().expect("events") {
        let event = event.as_object().expect("event object");
        assert!(!event.contains_key("id"));
        assert!(!event.contains_key("clipId"));
        assert!(!event.contains_key("photoId"));
    }
}

#[test]
fn to_sequence_rejects_invalid_exclusive_unions() {
    let mut project: serde_json::Value = serde_json::from_str(PROJECT_V1).unwrap();
    project["actions"] = json!([{
        "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "atMs": 1,
        "type": "key",
        "keycode": "ENTER",
        "chars": "ok"
    }]);
    let project: Project = serde_json::from_value(project).expect("deserialize invalid key");
    assert!(matches!(
        to_sequence(&project),
        Err(Error::InvalidAction(_))
    ));

    let neither = Action {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap(),
        at_ms: 1,
        kind: ActionKind::Key {
            keycode: None,
            chars: None,
            modifiers: None,
            hold_ms: 50,
        },
    };
    let mut project = parse_project(PROJECT_V1).unwrap();
    project.actions = vec![neither];
    assert!(matches!(
        to_sequence(&project),
        Err(Error::InvalidAction(_))
    ));

    let mixed_move = Action {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap(),
        at_ms: 1,
        kind: ActionKind::MouseMove {
            x: Some(0.5),
            y: Some(0.5),
            dx: Some(1),
            dy: Some(1),
        },
    };
    project.actions = vec![mixed_move];
    assert!(matches!(
        to_sequence(&project),
        Err(Error::InvalidAction(_))
    ));
}

#[test]
fn exported_sequence_round_trips_through_parse_sequence() {
    let project = parse_project(PROJECT_V1).expect("parse project v1");
    let sequence = to_sequence(&project).expect("export");
    let json = serde_json::to_string(&sequence).expect("serialize");
    let parsed = parse_sequence(&json).expect("parse exported sequence");
    assert_eq!(parsed, sequence);
    let _typed: Sequence = parsed;
}
