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

/** Actions live in `[0, total)`. `total` itself clamps onto the last millisecond. */
export function clampActionAtMs(ms: number, totalMs: number): number {
  if (!Number.isFinite(ms) || ms <= 0 || !(totalMs > 0)) {
    return 0;
  }
  const last = Math.max(0, totalMs - 1);
  if (ms >= last) {
    return last;
  }
  return Math.round(ms);
}

export function actionOnClip(action: Action, clip: Clip): boolean {
  return clip.startMs <= action.atMs && action.atMs < clip.startMs + clip.durationMs;
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

/** Fit-or-closer. UI-only; not persisted. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;
export const ZOOM_STEP = 1.25;
/** Pixel radius for playhead / edge snap. */
export const SNAP_THRESHOLD_PX = 8;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return MIN_ZOOM;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Clip edges, sequence origin, and keyframe times. */
export function snapTargetsMs(
  clips: readonly Clip[],
  actions: readonly Action[],
): number[] {
  const targets = new Set<number>([0]);
  for (const clip of clips) {
    targets.add(clip.startMs);
    targets.add(clip.startMs + clip.durationMs);
  }
  for (const action of actions) {
    targets.add(action.atMs);
  }
  return [...targets].sort((a, b) => a - b);
}

export function snapMs(
  ms: number,
  targets: readonly number[],
  thresholdMs: number,
): number {
  if (!(thresholdMs > 0) || targets.length === 0 || !Number.isFinite(ms)) {
    return ms;
  }
  let best = ms;
  let bestDist = thresholdMs;
  for (const target of targets) {
    const dist = Math.abs(target - ms);
    if (dist <= bestDist) {
      bestDist = dist;
      best = target;
    }
  }
  return best;
}

/** In-clip keyframes and this clip's current end; never before min duration. */
export function rippleSnapTargetsMs(
  clip: Clip,
  actions: readonly Action[],
): number[] {
  const end = clip.startMs + clip.durationMs;
  const minEnd = clip.startMs + MIN_CLIP_DURATION_MS;
  const targets = new Set<number>();
  if (end >= minEnd) {
    targets.add(end);
  }
  for (const action of actions) {
    if (action.atMs >= minEnd && action.atMs < end) {
      targets.add(action.atMs);
    }
  }
  return [...targets].sort((a, b) => a - b);
}

export function snapDurationMs(
  startMs: number,
  durationMs: number,
  targets: readonly number[],
  thresholdMs: number,
): number {
  const minEnd = startMs + MIN_CLIP_DURATION_MS;
  const allowed = targets.filter((target) => target >= minEnd);
  const end = snapMs(startMs + durationMs, allowed, thresholdMs);
  return clampClipDurationMs(end - startMs);
}

/** Aim for ~72px between ticks at the current zoom. */
export function tickStepMs(pxPerMs: number): number {
  if (!(pxPerMs > 0)) {
    return 1000;
  }
  const raw = 72 / pxPerMs;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
  return steps.find((step) => step >= raw) ?? 60000;
}
