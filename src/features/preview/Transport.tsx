import { useEffect } from "react";
import { Pause, Play, Square } from "lucide-react";
import {
  clampPlayheadMs,
  totalDurationMs,
  upcomingKeyframe,
} from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import type { Action } from "../../types/generated";

const BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 disabled:opacity-40 disabled:hover:bg-transparent";

function actionLabel(action: Action): string {
  switch (action.type) {
    case "tap":
      return "Tap";
    case "swipe":
      return "Swipe";
    case "key":
      return action.keycode ? `Key ${action.keycode}` : "Key";
    case "mouse_move":
      return "Mouse move";
    case "mouse_button":
      return "Mouse button";
    case "wait":
      return "Wait";
  }
}

export function Transport() {
  const project = useEditor((s) => s.project);
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const play = useEditor((s) => s.play);
  const pause = useEditor((s) => s.pause);
  const stop = useEditor((s) => s.stop);

  const totalMs = project ? totalDurationMs(project.clips) : 0;
  const canPlay = totalMs > 0;
  const upcoming = project
    ? upcomingKeyframe(project.actions, playheadMs)
    : undefined;

  useEffect(() => {
    if (!playing) {
      return;
    }
    // Wall-clock so 1s of playback is 1000 playhead ms, not N frames.
    let originMs = useEditor.getState().playheadMs;
    let originTime = performance.now();
    let lastWritten = originMs;
    let raf = 0;

    const tick = (now: number) => {
      const state = useEditor.getState();
      if (!state.playing) {
        return;
      }
      const total = state.project ? totalDurationMs(state.project.clips) : 0;
      if (!(total > 0)) {
        state.pause();
        return;
      }
      // Scrub / clip edits move the playhead; re-anchor instead of fighting them.
      if (state.playheadMs !== lastWritten) {
        originMs = state.playheadMs;
        originTime = now;
        lastWritten = state.playheadMs;
      }
      const next = clampPlayheadMs(originMs + (now - originTime), total);
      if (next !== lastWritten) {
        lastWritten = next;
        state.setPlayheadMs(next);
      }
      if (next >= total) {
        state.pause();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="Preview transport"
      title="Preview is not live HID"
    >
      <button
        type="button"
        className={BTN}
        aria-label="Play"
        disabled={!canPlay || playing}
        onClick={() => play()}
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className={BTN}
        aria-label="Pause"
        disabled={!playing}
        onClick={() => pause()}
      >
        <Pause className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className={BTN}
        aria-label="Stop"
        disabled={!canPlay || (!playing && playheadMs === 0)}
        onClick={() => stop()}
      >
        <Square className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span className="ml-1 tabular-nums text-[11px] text-zinc-500">
        {playheadMs} / {totalMs} ms
      </span>
      <span className="max-w-[12rem] truncate text-[11px] text-zinc-400">
        {upcoming
          ? `Next: ${actionLabel(upcoming)} · ${upcoming.atMs} ms`
          : canPlay
            ? "Next: none"
            : "No clips"}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-zinc-600">
        Not live HID
      </span>
    </div>
  );
}
