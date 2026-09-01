//! Packed clip timeline: ripple, reorder, and wait insert.
//!
//! Membership is a uniform half-open interval for every clip, including the last:
//! an action belongs to clip `i` iff `start <= at_ms < end`. Playhead [`clip_at`]
//! returns the last clip when `ms` is at or past the timeline end.

use crate::ids::{ActionId, ClipId};
use crate::project::{Action, ActionKind, Clip, Project};
use crate::Error;

/// Default duration for a newly created clip.
pub const DEFAULT_CLIP_DURATION_MS: u32 = 4000;
/// Minimum clip duration; ripple clamps to this.
pub const MIN_CLIP_DURATION_MS: u32 = 200;

pub fn clip_end_ms(clip: &Clip) -> u32 {
    clip.start_ms.saturating_add(clip.duration_ms)
}

pub fn total_duration_ms(clips: &[Clip]) -> u32 {
    clips.last().map(clip_end_ms).unwrap_or(0)
}

fn contains_ms(clip: &Clip, ms: u32) -> bool {
    clip.start_ms <= ms && ms < clip_end_ms(clip)
}

/// Uniform half-open lookup. `ms >= total` returns the last clip.
pub fn clip_at(clips: &[Clip], ms: u32) -> Option<&Clip> {
    if clips.is_empty() {
        return None;
    }
    if ms >= total_duration_ms(clips) {
        return clips.last();
    }
    clips.iter().find(|clip| contains_ms(clip, ms))
}

/// Smallest `at_ms >= playhead_ms`, or `None` if no later keyframe.
pub fn upcoming_keyframe(actions: &[Action], playhead_ms: u32) -> Option<&Action> {
    actions
        .iter()
        .filter(|action| action.at_ms >= playhead_ms)
        .min_by_key(|action| action.at_ms)
}

/// Rewrite `start_ms` so clips are contiguous from 0 with no gaps.
pub fn pack_clips(clips: &mut [Clip]) {
    let mut t = 0u32;
    for clip in clips {
        clip.start_ms = t;
        t = t.saturating_add(clip.duration_ms);
    }
}

fn clip_index(clips: &[Clip], id: ClipId) -> Result<usize, Error> {
    clips
        .iter()
        .position(|clip| clip.id == id)
        .ok_or_else(|| Error::clip_not_found(id))
}

fn clip_index_for_ms(clips: &[Clip], ms: u32) -> Option<usize> {
    if clips.is_empty() {
        return None;
    }
    if ms >= total_duration_ms(clips) {
        return Some(clips.len() - 1);
    }
    clips
        .iter()
        .position(|clip| contains_ms(clip, ms))
        .or_else(|| {
            clips
                .iter()
                .rposition(|clip| clip.start_ms <= ms)
                .or(Some(0))
        })
}

fn add_ms(at_ms: u32, delta: i64) -> u32 {
    let next = i64::from(at_ms).saturating_add(delta);
    if next <= 0 {
        0
    } else {
        u32::try_from(next).unwrap_or(u32::MAX)
    }
}

fn clamp_actions_to_timeline(project: &mut Project) {
    let total = total_duration_ms(&project.clips);
    let last_ms = total.saturating_sub(1);
    for action in &mut project.actions {
        if total == 0 {
            action.at_ms = 0;
        } else if action.at_ms >= total {
            action.at_ms = last_ms;
        }
    }
}

/// Change clip `clip_id`'s duration, keep in-clip actions attached, shift later ones.
pub fn ripple_clip(
    mut project: Project,
    clip_id: ClipId,
    new_duration_ms: u32,
) -> Result<Project, Error> {
    let i = clip_index(&project.clips, clip_id)?;
    let new_duration_ms = new_duration_ms.max(MIN_CLIP_DURATION_MS);
    let old_start = project.clips[i].start_ms;
    let old_duration = project.clips[i].duration_ms;
    let old_end = old_start.saturating_add(old_duration);
    let delta = i64::from(new_duration_ms) - i64::from(old_duration);

    for action in &mut project.actions {
        if clip_index_for_ms(&project.clips, action.at_ms) == Some(i) {
            // Keep-attached: stay on clip i; never silently move onto i+1.
            let offset = action.at_ms.saturating_sub(old_start);
            if offset >= new_duration_ms {
                action.at_ms = old_start.saturating_add(new_duration_ms.saturating_sub(1));
            }
        } else if action.at_ms >= old_end {
            action.at_ms = add_ms(action.at_ms, delta);
        }
    }

    project.clips[i].duration_ms = new_duration_ms;
    pack_clips(&mut project.clips);
    clamp_actions_to_timeline(&mut project);
    Ok(project)
}

/// Permute clips, then rewrite each action `at_ms` from its in-clip offset.
pub fn reorder_clips(mut project: Project, ordered_clip_ids: &[ClipId]) -> Result<Project, Error> {
    if ordered_clip_ids.len() != project.clips.len() {
        return Err(Error::invalid_timeline(
            "reorder clip ids must be a permutation of existing clips",
        ));
    }

    let snapshots: Vec<(ClipId, u32)> = if project.clips.is_empty() {
        Vec::new()
    } else {
        project
            .actions
            .iter()
            .map(|action| {
                let idx = clip_index_for_ms(&project.clips, action.at_ms)
                    .expect("non-empty clips resolve membership");
                let clip = &project.clips[idx];
                let offset = action
                    .at_ms
                    .saturating_sub(clip.start_ms)
                    .min(clip.duration_ms.saturating_sub(1));
                (clip.id, offset)
            })
            .collect()
    };

    let mut used = vec![false; project.clips.len()];
    let mut new_clips = Vec::with_capacity(project.clips.len());
    for id in ordered_clip_ids {
        let idx = clip_index(&project.clips, *id)?;
        if used[idx] {
            return Err(Error::invalid_timeline("duplicate clip id in reorder"));
        }
        used[idx] = true;
        new_clips.push(project.clips[idx].clone());
    }

    project.clips = new_clips;
    pack_clips(&mut project.clips);

    for (action, (clip_id, offset)) in project.actions.iter_mut().zip(snapshots) {
        let clip = project
            .clips
            .iter()
            .find(|clip| clip.id == clip_id)
            .expect("reorder snapshot clip exists");
        action.at_ms = clip.start_ms.saturating_add(offset);
    }

    clamp_actions_to_timeline(&mut project);
    Ok(project)
}

/// Insert a wait keyframe at `at_ms` and shift later actions by `duration_ms`.
///
/// Always grows the owning clip by `duration_ms` so later in-clip offsets stay
/// stable, then grows further if the wait would still fall off the end.
pub fn insert_wait(mut project: Project, at_ms: u32, duration_ms: u32) -> Result<Project, Error> {
    let Some(owner_id) = clip_at(&project.clips, at_ms).map(|clip| clip.id) else {
        return Err(Error::invalid_timeline(
            "insert_wait requires at least one clip",
        ));
    };
    let owner_idx = clip_index(&project.clips, owner_id)?;

    for action in &mut project.actions {
        if action.at_ms > at_ms {
            action.at_ms = action.at_ms.saturating_add(duration_ms);
        }
    }

    project.actions.push(Action {
        id: ActionId::new(),
        at_ms,
        kind: ActionKind::Wait { duration_ms },
    });

    let clip = &mut project.clips[owner_idx];
    let grown = clip.duration_ms.saturating_add(duration_ms);
    let min_to_include_wait = at_ms.saturating_sub(clip.start_ms).saturating_add(1);
    clip.duration_ms = grown.max(min_to_include_wait).max(MIN_CLIP_DURATION_MS);

    pack_clips(&mut project.clips);
    clamp_actions_to_timeline(&mut project);
    Ok(project)
}
