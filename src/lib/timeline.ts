import type { Action, Clip } from "../types/generated";

/** Matches `picoflow_core::DEFAULT_CLIP_DURATION_MS`. */
export const DEFAULT_CLIP_DURATION_MS = 4000;
/** Matches `picoflow_core::MIN_CLIP_DURATION_MS`. */
export const MIN_CLIP_DURATION_MS = 200;

export function totalDurationMs(clips: readonly Clip[]): number {
  if (clips.length === 0) {
    return 0;
  }
  const last = clips[clips.length - 1];
  return last.startMs + last.durationMs;
}

export function clampClipDurationMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return MIN_CLIP_DURATION_MS;
  }
  return Math.max(MIN_CLIP_DURATION_MS, Math.round(ms));
}

export function clampPlayheadMs(ms: number, totalMs: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  if (!(totalMs > 0) || ms >= totalMs) {
    return Math.max(0, totalMs);
  }
  return Math.round(ms);
}

/** Half-open clip lookup. `ms >= total` returns the last clip. */
export function clipAt(clips: readonly Clip[], ms: number): Clip | undefined {
  if (clips.length === 0) {
    return undefined;
  }
  const last = clips[clips.length - 1];
  const total = totalDurationMs(clips);
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
