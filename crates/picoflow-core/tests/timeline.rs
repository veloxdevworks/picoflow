use picoflow_core::{
    clip_at, insert_wait, pack_clips, reorder_clips, ripple_clip, upcoming_keyframe, Action,
    ActionId, ActionKind, Clip, ClipId, Error, PhotoId, Project, Target, MIN_CLIP_DURATION_MS,
};
use serde::Deserialize;

const CLIP_AT_FIXTURE: &str = include_str!("fixtures/timeline/clip_at.json");
const SHORTEN_PAST_KEYFRAME: &str = include_str!("fixtures/timeline/shorten_past_keyframe.json");
const REORDER_FIXTURE: &str = include_str!("fixtures/timeline/reorder.json");
const INSERT_WAIT_FIXTURE: &str = include_str!("fixtures/timeline/insert_wait.json");

const PHOTO: &str = "01M1FDF09T000EJZKZA8CK8SR0";
const CLIP_A: &str = "01M1FDF09T000FDT4HY97S6X81";
const CLIP_B: &str = "01M1FDF09T000FDT4HY97S6X82";
const CLIP_C: &str = "01M1FDF09T000FDT4HY97S6X83";
const ACT_1: &str = "01M1FDF09T0003ZGB5Y17A5182";
const ACT_2: &str = "01M1FDF09T0008BND1MW6JQNG3";
const ACT_3: &str = "01M1FDF09T00037GHHC52ZMW04";

fn id_clip(raw: &str) -> ClipId {
    raw.parse().expect("clip id")
}

fn id_action(raw: &str) -> ActionId {
    raw.parse().expect("action id")
}

fn id_photo(raw: &str) -> PhotoId {
    raw.parse().expect("photo id")
}

fn clip(id: &str, start_ms: u32, duration_ms: u32) -> Clip {
    Clip {
        id: id_clip(id),
        photo_id: id_photo(PHOTO),
        start_ms,
        duration_ms,
    }
}

fn tap(id: &str, at_ms: u32) -> Action {
    Action {
        id: id_action(id),
        at_ms,
        kind: ActionKind::Tap {
            x: 0.5,
            y: 0.5,
            hold_ms: 60,
        },
    }
}

fn project(clips: Vec<Clip>, actions: Vec<Action>) -> Project {
    Project {
        version: 1,
        name: "test".into(),
        target: Target::default(),
        photos: vec![],
        clips,
        actions,
    }
}

fn action_at(project: &Project, id: &str) -> u32 {
    let id = id_action(id);
    project
        .actions
        .iter()
        .find(|action| action.id == id)
        .expect("action")
        .at_ms
}

fn clip_by_id<'a>(project: &'a Project, id: &str) -> &'a Clip {
    let id = id_clip(id);
    project
        .clips
        .iter()
        .find(|clip| clip.id == id)
        .expect("clip")
}

#[derive(Debug, Deserialize)]
struct ClipAtFile {
    scenarios: Vec<ClipAtScenario>,
}

#[derive(Debug, Deserialize)]
struct ClipAtScenario {
    name: String,
    clips: Vec<Clip>,
    actions: Vec<Action>,
    #[serde(rename = "clipAt")]
    clip_at: Vec<ClipAtCase>,
    upcoming: Vec<UpcomingCase>,
}

#[derive(Debug, Deserialize)]
struct ClipAtCase {
    ms: u32,
    #[serde(rename = "clipId")]
    clip_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpcomingCase {
    ms: u32,
    #[serde(rename = "actionId")]
    action_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExpectedClip {
    id: ClipId,
    #[serde(rename = "startMs")]
    start_ms: u32,
    #[serde(rename = "durationMs")]
    duration_ms: u32,
}

#[derive(Debug, Deserialize)]
struct ExpectedAction {
    id: ActionId,
    #[serde(rename = "atMs")]
    at_ms: u32,
}

#[derive(Debug, Deserialize)]
struct ShortenFixture {
    project: Project,
    #[serde(rename = "clipId")]
    clip_id: ClipId,
    #[serde(rename = "newDurationMs")]
    new_duration_ms: u32,
    expected: ShortenExpected,
}

#[derive(Debug, Deserialize)]
struct ShortenExpected {
    clips: Vec<ExpectedClip>,
    actions: Vec<ExpectedAction>,
}

#[derive(Debug, Deserialize)]
struct ReorderFixture {
    project: Project,
    #[serde(rename = "orderedClipIds")]
    ordered_clip_ids: Vec<ClipId>,
    expected: ShortenExpected,
}

#[derive(Debug, Deserialize)]
struct InsertWaitFixture {
    project: Project,
    #[serde(rename = "atMs")]
    at_ms: u32,
    #[serde(rename = "durationMs")]
    duration_ms: u32,
    expected: InsertWaitExpected,
}

#[derive(Debug, Deserialize)]
struct InsertWaitExpected {
    #[serde(rename = "clipDurations")]
    clip_durations: Vec<u32>,
    #[serde(rename = "clipStarts")]
    clip_starts: Vec<u32>,
    #[serde(rename = "actionAtMs")]
    action_at_ms: std::collections::HashMap<String, u32>,
    #[serde(rename = "waitAtMs")]
    wait_at_ms: u32,
    #[serde(rename = "waitDurationMs")]
    wait_duration_ms: u32,
}

#[test]
fn pack_rewrites_starts_from_zero() {
    let mut clips = vec![
        clip(CLIP_A, 50, 4000),
        clip(CLIP_B, 9999, 2000),
        clip(CLIP_C, 0, 1000),
    ];
    pack_clips(&mut clips);
    assert_eq!(clips[0].start_ms, 0);
    assert_eq!(clips[1].start_ms, 4000);
    assert_eq!(clips[2].start_ms, 6000);
}

#[test]
fn pack_empty_is_noop() {
    let mut clips: Vec<Clip> = vec![];
    pack_clips(&mut clips);
    assert!(clips.is_empty());
}

#[test]
fn min_duration_clamps_ripple() {
    let p = project(vec![clip(CLIP_A, 0, 4000)], vec![tap(ACT_1, 100)]);
    let p = ripple_clip(p, id_clip(CLIP_A), 50).expect("ripple");
    assert_eq!(p.clips[0].duration_ms, MIN_CLIP_DURATION_MS);
    assert_eq!(action_at(&p, ACT_1), 100);
}

#[test]
fn ripple_right_edge_grows_and_shifts_later() {
    let p = project(
        vec![clip(CLIP_A, 0, 4000), clip(CLIP_B, 4000, 4000)],
        vec![tap(ACT_1, 1000), tap(ACT_2, 5000)],
    );
    let p = ripple_clip(p, id_clip(CLIP_A), 5000).expect("ripple");
    assert_eq!(clip_by_id(&p, CLIP_A).duration_ms, 5000);
    assert_eq!(clip_by_id(&p, CLIP_B).start_ms, 5000);
    assert_eq!(action_at(&p, ACT_1), 1000);
    assert_eq!(action_at(&p, ACT_2), 6000);
}

#[test]
fn ripple_chained_clips_shift() {
    let p = project(
        vec![
            clip(CLIP_A, 0, 4000),
            clip(CLIP_B, 4000, 4000),
            clip(CLIP_C, 8000, 2000),
        ],
        vec![tap(ACT_1, 100), tap(ACT_2, 4500), tap(ACT_3, 8500)],
    );
    let p = ripple_clip(p, id_clip(CLIP_A), 3000).expect("ripple");
    assert_eq!(clip_by_id(&p, CLIP_B).start_ms, 3000);
    assert_eq!(clip_by_id(&p, CLIP_C).start_ms, 7000);
    assert_eq!(action_at(&p, ACT_1), 100);
    assert_eq!(action_at(&p, ACT_2), 3500);
    assert_eq!(action_at(&p, ACT_3), 7500);
}

#[test]
fn ripple_unknown_clip_is_not_found() {
    let p = project(vec![clip(CLIP_A, 0, 4000)], vec![]);
    let err = ripple_clip(p, id_clip(CLIP_B), 4000).unwrap_err();
    assert!(matches!(err, Error::ClipNotFound(_)));
}

#[test]
fn clip_at_golden_fixtures() {
    let file: ClipAtFile = serde_json::from_str(CLIP_AT_FIXTURE).expect("clip_at fixture");
    for scenario in file.scenarios {
        for case in &scenario.clip_at {
            let found = clip_at(&scenario.clips, case.ms);
            let found_id = found.map(|clip| clip.id.to_string());
            assert_eq!(
                found_id, case.clip_id,
                "{} clip_at({})",
                scenario.name, case.ms
            );
        }
        for case in &scenario.upcoming {
            let found = upcoming_keyframe(&scenario.actions, case.ms);
            let found_id = found.map(|action| action.id.to_string());
            assert_eq!(
                found_id, case.action_id,
                "{} upcoming({})",
                scenario.name, case.ms
            );
        }
    }
}

#[test]
fn empty_project_clip_at_none() {
    assert!(clip_at(&[], 0).is_none());
    assert!(upcoming_keyframe(&[], 0).is_none());
}

#[test]
fn shorten_past_keyframe_golden() {
    let fixture: ShortenFixture =
        serde_json::from_str(SHORTEN_PAST_KEYFRAME).expect("shorten fixture");
    let result = ripple_clip(fixture.project, fixture.clip_id, fixture.new_duration_ms)
        .expect("ripple shorten");

    assert_eq!(result.clips.len(), fixture.expected.clips.len());
    for (got, exp) in result.clips.iter().zip(&fixture.expected.clips) {
        assert_eq!(got.id, exp.id);
        assert_eq!(got.start_ms, exp.start_ms);
        assert_eq!(got.duration_ms, exp.duration_ms);
    }
    for exp in &fixture.expected.actions {
        let got = result
            .actions
            .iter()
            .find(|action| action.id == exp.id)
            .expect("action");
        assert_eq!(got.at_ms, exp.at_ms);
    }

    let tap = result
        .actions
        .iter()
        .find(|action| action.id == id_action(ACT_1))
        .expect("clamped tap");
    let owner = clip_at(&result.clips, tap.at_ms).expect("still on a clip");
    assert_eq!(owner.id, id_clip(CLIP_A));
    assert_eq!(tap.at_ms, 1999);
}

#[test]
fn reorder_remaps_by_in_clip_offset() {
    let fixture: ReorderFixture = serde_json::from_str(REORDER_FIXTURE).expect("reorder fixture");
    let result = reorder_clips(fixture.project, &fixture.ordered_clip_ids).expect("reorder");

    for (got, exp) in result.clips.iter().zip(&fixture.expected.clips) {
        assert_eq!(got.id, exp.id);
        assert_eq!(got.start_ms, exp.start_ms);
        assert_eq!(got.duration_ms, exp.duration_ms);
    }
    for exp in &fixture.expected.actions {
        let got = result
            .actions
            .iter()
            .find(|action| action.id == exp.id)
            .expect("action");
        assert_eq!(got.at_ms, exp.at_ms);
    }
}

#[test]
fn reorder_rejects_non_permutation() {
    let p = project(
        vec![clip(CLIP_A, 0, 4000), clip(CLIP_B, 4000, 4000)],
        vec![],
    );
    let missing = reorder_clips(p.clone(), &[id_clip(CLIP_A)]).unwrap_err();
    assert!(matches!(missing, Error::InvalidTimeline(_)));

    let dup = reorder_clips(p.clone(), &[id_clip(CLIP_A), id_clip(CLIP_A)]).unwrap_err();
    assert!(matches!(dup, Error::InvalidTimeline(_)) || matches!(dup, Error::ClipNotFound(_)));

    let unknown = reorder_clips(p, &[id_clip(CLIP_A), id_clip(CLIP_C)]).unwrap_err();
    assert!(matches!(unknown, Error::ClipNotFound(_)));
}

#[test]
fn reorder_empty_project() {
    let p = project(vec![], vec![]);
    let result = reorder_clips(p, &[]).expect("empty reorder");
    assert!(result.clips.is_empty());
}

#[test]
fn insert_wait_ripples_later_actions() {
    let fixture: InsertWaitFixture =
        serde_json::from_str(INSERT_WAIT_FIXTURE).expect("insert_wait fixture");
    let before_len = fixture.project.actions.len();
    let result = insert_wait(fixture.project, fixture.at_ms, fixture.duration_ms).expect("wait");

    assert_eq!(result.actions.len(), before_len + 1);
    for (clip, duration) in result.clips.iter().zip(&fixture.expected.clip_durations) {
        assert_eq!(clip.duration_ms, *duration);
    }
    for (clip, start) in result.clips.iter().zip(&fixture.expected.clip_starts) {
        assert_eq!(clip.start_ms, *start);
    }
    for (id, at_ms) in &fixture.expected.action_at_ms {
        assert_eq!(action_at(&result, id), *at_ms);
    }
    let wait = result
        .actions
        .iter()
        .find(|action| matches!(action.kind, ActionKind::Wait { .. }))
        .expect("wait keyframe");
    assert_eq!(wait.at_ms, fixture.expected.wait_at_ms);
    match &wait.kind {
        ActionKind::Wait { duration_ms } => {
            assert_eq!(*duration_ms, fixture.expected.wait_duration_ms)
        }
        other => panic!("expected wait, got {other:?}"),
    }
}

#[test]
fn insert_wait_extends_clip_when_wait_would_fall_off() {
    let p = project(
        vec![clip(CLIP_A, 0, 4000), clip(CLIP_B, 4000, 4000)],
        vec![tap(ACT_1, 1000)],
    );
    let result = insert_wait(p, 8000, 500).expect("wait at end");
    assert_eq!(result.clips[0].duration_ms, 4000);
    assert_eq!(result.clips[1].duration_ms, 4500);
    assert_eq!(result.clips[1].start_ms, 4000);
    assert_eq!(action_at(&result, ACT_1), 1000);
    let wait = result
        .actions
        .iter()
        .find(|action| matches!(action.kind, ActionKind::Wait { .. }))
        .expect("wait");
    assert_eq!(wait.at_ms, 8000);
    let owner = clip_at(&result.clips, wait.at_ms).expect("wait on a clip");
    assert_eq!(owner.id, id_clip(CLIP_B));
    assert!(wait.at_ms < owner.start_ms + owner.duration_ms);
}

#[test]
fn insert_wait_overflow_ripple_does_not_clamp() {
    let p = project(vec![clip(CLIP_A, 0, 4000)], vec![tap(ACT_1, 3500)]);
    let result = insert_wait(p, 1000, 1000).expect("wait");
    assert_eq!(result.clips[0].duration_ms, 5000);
    assert_eq!(action_at(&result, ACT_1), 4500);
    let tap_owner = clip_at(&result.clips, 4500).expect("tap on a clip");
    assert_eq!(tap_owner.id, id_clip(CLIP_A));
    let wait = result
        .actions
        .iter()
        .find(|action| matches!(action.kind, ActionKind::Wait { .. }))
        .expect("wait");
    assert_eq!(wait.at_ms, 1000);
}

#[test]
fn insert_wait_keeps_later_clip_offsets() {
    let p = project(
        vec![clip(CLIP_A, 0, 4000), clip(CLIP_B, 4000, 4000)],
        vec![tap(ACT_1, 3500), tap(ACT_2, 7500)],
    );
    let result = insert_wait(p, 1000, 1000).expect("wait");
    assert_eq!(clip_by_id(&result, CLIP_A).duration_ms, 5000);
    assert_eq!(clip_by_id(&result, CLIP_B).start_ms, 5000);
    assert_eq!(clip_by_id(&result, CLIP_B).duration_ms, 4000);
    assert_eq!(action_at(&result, ACT_1), 4500);
    assert_eq!(action_at(&result, ACT_2), 8500);
    assert_eq!(
        clip_at(&result.clips, action_at(&result, ACT_1))
            .expect("same-clip tap")
            .id,
        id_clip(CLIP_A)
    );
    assert_eq!(
        clip_at(&result.clips, action_at(&result, ACT_2))
            .expect("later-clip tap")
            .id,
        id_clip(CLIP_B)
    );
}

#[test]
fn insert_wait_empty_project_errors() {
    let p = project(vec![], vec![]);
    let err = insert_wait(p, 0, 200).unwrap_err();
    assert!(matches!(err, Error::InvalidTimeline(_)));
}
