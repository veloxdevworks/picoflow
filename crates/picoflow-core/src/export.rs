use crate::project::{ActionKind, Project, PROJECT_SCHEMA_VERSION};
use crate::sequence::{EventKind, Sequence, SequenceEvent, SEQUENCE_SCHEMA_VERSION};
use crate::{ensure_version, Error};

/// Flatten a project into on-device `sequence.json` (snake_case, no clips/photos).
pub fn to_sequence(project: &Project) -> Result<Sequence, Error> {
    ensure_version(project.version, PROJECT_SCHEMA_VERSION)?;
    project.validate_actions()?;

    let mut events: Vec<SequenceEvent> = project
        .actions
        .iter()
        .map(|action| SequenceEvent {
            at_ms: action.at_ms,
            kind: event_kind(&action.kind),
        })
        .collect();
    events.sort_by_key(|event| event.at_ms);

    let sequence = Sequence {
        version: SEQUENCE_SCHEMA_VERSION,
        run_mode: project.target.run_mode,
        settle_ms: project.target.settle_ms,
        hid_profile: project.target.hid_profile,
        button_pin: project.target.button_pin.clone(),
        events,
    };
    sequence.validate_events()?;
    Ok(sequence)
}

fn event_kind(kind: &ActionKind) -> EventKind {
    match kind {
        ActionKind::Tap { x, y, hold_ms } => EventKind::Tap {
            x: *x,
            y: *y,
            hold_ms: *hold_ms,
        },
        ActionKind::Swipe {
            x0,
            y0,
            x1,
            y1,
            duration_ms,
        } => EventKind::Swipe {
            x0: *x0,
            y0: *y0,
            x1: *x1,
            y1: *y1,
            duration_ms: *duration_ms,
        },
        ActionKind::Key {
            keycode,
            chars,
            modifiers,
            hold_ms,
        } => EventKind::Key {
            keycode: keycode.clone(),
            chars: chars.clone(),
            modifiers: modifiers.clone(),
            hold_ms: *hold_ms,
        },
        ActionKind::MouseMove { x, y, dx, dy } => EventKind::MouseMove {
            x: *x,
            y: *y,
            dx: *dx,
            dy: *dy,
        },
        ActionKind::MouseButton { button, op } => EventKind::MouseButton {
            button: *button,
            op: *op,
        },
        ActionKind::Wait { duration_ms } => EventKind::Wait {
            duration_ms: *duration_ms,
        },
    }
}
