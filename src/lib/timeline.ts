import type { Action, Clip } from "../types/generated";

/** Matches `picoflow_core::DEFAULT_CLIP_DURATION_MS`. */
export const DEFAULT_CLIP_DURATION_MS = 4000;

/** Half-open clip lookup. `ms >= total` returns the last clip. */
export function clipAt(clips: readonly Clip[], ms: number): Clip | undefined {
  if (clips.length === 0) {
    return undefined;
  }
  const last = clips[clips.length - 1];
  const total = last.startMs + last.durationMs;
  if (ms >= total) {
    return last;
  }
  return clips.find((clip) => clip.startMs <= ms && ms < clip.startMs + clip.durationMs);
}

/** Smallest `atMs >= playheadMs`. */
export function upcomingKeyframe(
  actions: readonly Action[],
  playheadMs: number,
): Action | undefined {
  let best: Action | undefined;
  for (const action of actions) {
    if (action.atMs >= playheadMs && (best === undefined || action.atMs < best.atMs)) {
      best = action;
    }
  }
  return best;
}
