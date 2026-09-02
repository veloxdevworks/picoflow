import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GanttChart } from "lucide-react";
import {
  clampClipDurationMs,
  clampPlayheadMs,
  clipAt,
  totalDurationMs,
} from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import { errorMessage, reorderClips, rippleClip } from "../../types/commands";
import type { Clip } from "../../types/generated";
import { ActionTrack } from "./ActionTrack";
import { ClipTrack, type RubberBand } from "./ClipTrack";
import { Playhead } from "./Playhead";

const REORDER_SLOP_PX = 6;

type Drag =
  | {
      kind: "ripple";
      clipId: string;
      originDuration: number;
      originX: number;
      pointerId: number;
    }
  | {
      kind: "reorder";
      clipId: string;
      fromIndex: number;
      originIds: string[];
      originClips: Clip[];
      originX: number;
      pointerId: number;
      started: boolean;
    }
  | { kind: "scrub"; pointerId: number };

function sameIds(a: readonly string[] | null, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  return a.every((id, i) => id === b[i]);
}

function moveId(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return ids.slice();
  }
  const next = ids.slice();
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

function indexAtMs(clips: readonly Clip[], ms: number): number {
  if (clips.length === 0) {
    return 0;
  }
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (ms < clip.startMs + clip.durationMs / 2) {
      return i;
    }
  }
  return clips.length - 1;
}

function tickStepMs(totalMs: number): number {
  if (totalMs <= 4000) {
    return 1000;
  }
  if (totalMs <= 12000) {
    return 2000;
  }
  if (totalMs <= 30000) {
    return 5000;
  }
  if (totalMs <= 60000) {
    return 10000;
  }
  return 15000;
}

function formatTick(ms: number): string {
  const s = ms / 1000;
  if (s >= 10 && s % 1 === 0) {
    return `${s.toFixed(0)}s`;
  }
  return `${s.toFixed(1)}s`;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const selection = useEditor((s) => s.selection);
  const playheadMs = useEditor((s) => s.playheadMs);
  const photoRev = useEditor((s) => s.photoRev);
  const setProject = useEditor((s) => s.setProject);
  const setSelection = useEditor((s) => s.setSelection);
  const setPlayheadMs = useEditor((s) => s.setPlayheadMs);

  const clips = project?.clips ?? [];
  const actions = project?.actions ?? [];
  const photos = project?.photos ?? [];
  const totalMs = totalDurationMs(clips);

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const busyRef = useRef(false);
  const pxPerMsRef = useRef(0);
  const totalMsRef = useRef(0);
  const clipsRef = useRef(clips);
  const rubberBandRef = useRef<RubberBand | null>(null);
  const reorderIdsRef = useRef<string[] | null>(null);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);

  const [width, setWidth] = useState(0);
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const [reorderIds, setReorderIds] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pxPerMs = width > 0 && totalMs > 0 ? width / totalMs : 0;
  pxPerMsRef.current = pxPerMs;
  totalMsRef.current = totalMs;
  clipsRef.current = clips;
  rubberBandRef.current = rubberBand;
  reorderIdsRef.current = reorderIds;

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    setWidth(el.getBoundingClientRect().width);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, clips.length]);

  const clientXToMs = useCallback((clientX: number): number => {
    const el = trackRef.current;
    const scale = pxPerMsRef.current;
    if (!el || !(scale > 0)) {
      return 0;
    }
    const x = clientX - el.getBoundingClientRect().left;
    return clampPlayheadMs(x / scale, totalMsRef.current);
  }, []);

  const applyPlayhead = useCallback(
    (ms: number) => {
      const next = clampPlayheadMs(ms, totalMsRef.current);
      setPlayheadMs(next);
      const clip = clipAt(clipsRef.current, next);
      if (clip) {
        setSelection({ type: "clip", id: clip.id });
      }
    },
    [setPlayheadMs, setSelection],
  );

  const stopListening = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) {
      return;
    }
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.up);
    listenersRef.current = null;
  }, []);

  const commitRipple = useCallback(
    async (clipId: string, durationMs: number, originDuration: number) => {
      const current = useEditor.getState().project;
      if (!current || durationMs === originDuration) {
        setRubberBand(null);
        return;
      }
      busyRef.current = true;
      setError(null);
      try {
        const next = await rippleClip(current, clipId, durationMs);
        setProject(next);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setRubberBand(null);
        busyRef.current = false;
      }
    },
    [setProject],
  );

  const commitReorder = useCallback(
    async (originIds: string[], nextIds: string[]) => {
      const current = useEditor.getState().project;
      if (!current || sameIds(originIds, nextIds)) {
        setReorderIds(null);
        setDraggingId(null);
        return;
      }
      busyRef.current = true;
      setError(null);
      try {
        const next = await reorderClips(current, nextIds);
        setProject(next);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setReorderIds(null);
        setDraggingId(null);
        busyRef.current = false;
      }
    },
    [setProject],
  );

  const onMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      if (drag.kind === "ripple") {
        const scale = pxPerMsRef.current;
        if (!(scale > 0)) {
          return;
        }
        const durationMs = clampClipDurationMs(
          drag.originDuration + (event.clientX - drag.originX) / scale,
        );
        setRubberBand((prev) =>
          prev?.clipId === drag.clipId && prev.durationMs === durationMs
            ? prev
            : { clipId: drag.clipId, durationMs },
        );
        return;
      }
      if (drag.kind === "reorder") {
        if (
          !drag.started &&
          Math.abs(event.clientX - drag.originX) < REORDER_SLOP_PX
        ) {
          return;
        }
        drag.started = true;
        setDraggingId(drag.clipId);
        const to = indexAtMs(drag.originClips, clientXToMs(event.clientX));
        const ids = moveId(drag.originIds, drag.fromIndex, to);
        setReorderIds((prev) => (sameIds(prev, ids) ? prev : ids));
        return;
      }
      applyPlayhead(clientXToMs(event.clientX));
    },
    [applyPlayhead, clientXToMs],
  );

  const onUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      dragRef.current = null;
      stopListening();

      if (drag.kind === "scrub") {
        return;
      }
      if (drag.kind === "ripple") {
        const durationMs =
          rubberBandRef.current?.clipId === drag.clipId
            ? rubberBandRef.current.durationMs
            : drag.originDuration;
        void commitRipple(drag.clipId, durationMs, drag.originDuration);
        return;
      }
      if (!drag.started) {
        setReorderIds(null);
        setDraggingId(null);
        return;
      }
      void commitReorder(drag.originIds, reorderIdsRef.current ?? drag.originIds);
    },
    [commitReorder, commitRipple, stopListening],
  );

  const startListening = useCallback(() => {
    stopListening();
    listenersRef.current = { move: onMove, up: onUp };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [onMove, onUp, stopListening]);

  useEffect(() => {
    return () => stopListening();
  }, [stopListening]);

  const onScrubPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || busyRef.current || clipsRef.current.length === 0) {
        return;
      }
      event.preventDefault();
      dragRef.current = { kind: "scrub", pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPlayhead(clientXToMs(event.clientX));
      startListening();
    },
    [applyPlayhead, clientXToMs, startListening],
  );

  const onClipPointerDown = useCallback(
    (clipId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || busyRef.current) {
        return;
      }
      const fromIndex = clipsRef.current.findIndex((clip) => clip.id === clipId);
      if (fromIndex < 0) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind: "reorder",
        clipId,
        fromIndex,
        originIds: clipsRef.current.map((clip) => clip.id),
        originClips: clipsRef.current.slice(),
        originX: event.clientX,
        pointerId: event.pointerId,
        started: false,
      };
      startListening();
    },
    [startListening],
  );

  const onEdgePointerDown = useCallback(
    (clipId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || busyRef.current) {
        return;
      }
      const clip = clipsRef.current.find((item) => item.id === clipId);
      if (!clip) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind: "ripple",
        clipId,
        originDuration: clip.durationMs,
        originX: event.clientX,
        pointerId: event.pointerId,
      };
      setRubberBand({ clipId, durationMs: clip.durationMs });
      startListening();
    },
    [startListening],
  );

  const onSelectClip = useCallback(
    (clipId: string) => {
      const clip = clipsRef.current.find((item) => item.id === clipId);
      if (!clip) {
        return;
      }
      setSelection({ type: "clip", id: clipId });
      const current = useEditor.getState().playheadMs;
      if (clipAt(clipsRef.current, current)?.id !== clipId) {
        setPlayheadMs(clip.startMs);
      }
    },
    [setPlayheadMs, setSelection],
  );

  const onSelectAction = useCallback(
    (actionId: string, atMs: number) => {
      setSelection({ type: "action", id: actionId });
      setPlayheadMs(clampPlayheadMs(atMs, totalMsRef.current));
    },
    [setPlayheadMs, setSelection],
  );

  useEffect(() => {
    if (playheadMs > totalMs) {
      setPlayheadMs(totalMs);
    }
  }, [playheadMs, setPlayheadMs, totalMs]);

  if (!project) {
    return (
      <Empty
        hint="Clips and keyframes will sit on two tracks here."
        label="Timeline"
      />
    );
  }

  if (clips.length === 0) {
    return (
      <Empty
        hint="Confirm a warped photo to append a 4s clip."
        label="No clips"
      />
    );
  }

  const selectedClipId = selection?.type === "clip" ? selection.id : null;
  const selectedActionId = selection?.type === "action" ? selection.id : null;
  const ticks: number[] = [];
  if (totalMs > 0) {
    const step = tickStepMs(totalMs);
    for (let t = 0; t <= totalMs; t += step) {
      ticks.push(t);
    }
    if (ticks[ticks.length - 1] !== totalMs) {
      ticks.push(totalMs);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col select-none">
      {error ? (
        <p className="truncate px-2 py-1 text-[11px] text-red-400" title={error}>
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-12 shrink-0 flex-col border-r border-zinc-800 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <div className="h-5 border-b border-zinc-800" />
          <div className="flex flex-1 items-center px-1.5">Clips</div>
          <div className="flex h-8 items-center border-t border-zinc-800 px-1.5">
            Keys
          </div>
        </div>
        <div
          ref={trackRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          onPointerDown={onScrubPointerDown}
        >
          <div className="relative h-5 border-b border-zinc-800 bg-zinc-950">
            {ticks.map((ms) => (
              <span
                key={ms}
                className="absolute top-0.5 -translate-x-1/2 text-[10px] text-zinc-600 first:translate-x-0 last:-translate-x-full"
                style={{ left: ms * pxPerMs }}
              >
                {formatTick(ms)}
              </span>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-8 top-5">
            <ClipTrack
              clips={clips}
              photos={photos}
              projectDir={projectDir}
              photoRev={photoRev}
              pxPerMs={pxPerMs}
              selectedId={selectedClipId}
              rubberBand={rubberBand}
              reorderIds={reorderIds}
              draggingId={draggingId}
              onSelect={onSelectClip}
              onClipPointerDown={onClipPointerDown}
              onEdgePointerDown={onEdgePointerDown}
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-8">
            <ActionTrack
              actions={actions}
              pxPerMs={pxPerMs}
              selectedId={selectedActionId}
              onSelect={onSelectAction}
            />
          </div>
          <Playhead ms={playheadMs} pxPerMs={pxPerMs} />
        </div>
      </div>
    </div>
  );
}

function Empty({ hint, label }: { hint: string; label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <GanttChart className="h-5 w-5 text-zinc-600" aria-hidden />
      <p className="text-sm font-medium text-zinc-400">{label}</p>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-600">{hint}</p>
    </div>
  );
}
