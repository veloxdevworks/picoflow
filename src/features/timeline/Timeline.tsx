import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  GanttChart,
  Magnet,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  clampClipDurationMs,
  clampPlayheadMs,
  clampZoom,
  clipAt,
  MAX_ZOOM,
  MIN_ZOOM,
  SNAP_THRESHOLD_PX,
  rippleSnapTargetsMs,
  snapDurationMs,
  snapMs,
  snapTargetsMs,
  tickStepMs,
  totalDurationMs,
  ZOOM_STEP,
} from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import { errorMessage, reorderClips, rippleClip } from "../../types/commands";
import type { Action, Clip } from "../../types/generated";
import { ActionTrack } from "./ActionTrack";
import { ClipTrack, type RubberBand } from "./ClipTrack";
import { Playhead } from "./Playhead";

const REORDER_SLOP_PX = 6;
const RESIZE_STEP_MS = 100;

type RippleDrag = {
  kind: "ripple";
  clipId: string;
  originDuration: number;
  originX: number;
  pointerId: number;
  durationMs: number;
};

type ReorderDrag = {
  kind: "reorder";
  clipId: string;
  fromIndex: number;
  originIds: string[];
  originClips: Clip[];
  originX: number;
  pointerId: number;
  started: boolean;
  orderedIds: string[];
};

type Drag = RippleDrag | ReorderDrag | { kind: "scrub"; pointerId: number };

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

function rippleDurationAt(
  drag: RippleDrag,
  clientX: number,
  pxPerMs: number,
): number {
  if (!(pxPerMs > 0)) {
    return drag.durationMs;
  }
  return clampClipDurationMs(
    drag.originDuration + (clientX - drag.originX) / pxPerMs,
  );
}

function reorderIdsAt(drag: ReorderDrag, ms: number): string[] {
  return moveId(drag.originIds, drag.fromIndex, indexAtMs(drag.originClips, ms));
}

function formatTick(ms: number): string {
  const s = ms / 1000;
  if (s >= 10 && s % 1 === 0) {
    return `${s.toFixed(0)}s`;
  }
  return `${s.toFixed(1)}s`;
}

function maybeSnapMs(
  ms: number,
  enabled: boolean,
  pxPerMs: number,
  clips: readonly Clip[],
  actions: readonly Action[],
): number {
  if (!enabled || !(pxPerMs > 0)) {
    return ms;
  }
  return snapMs(
    ms,
    snapTargetsMs(clips, actions),
    SNAP_THRESHOLD_PX / pxPerMs,
  );
}

function maybeSnapRipple(
  drag: RippleDrag,
  clientX: number,
  pxPerMs: number,
  enabled: boolean,
  clips: readonly Clip[],
  actions: readonly Action[],
): number {
  const durationMs = rippleDurationAt(drag, clientX, pxPerMs);
  if (!enabled || !(pxPerMs > 0)) {
    return durationMs;
  }
  const clip = clips.find((item) => item.id === drag.clipId);
  if (!clip) {
    return durationMs;
  }
  return snapDurationMs(
    clip.startMs,
    durationMs,
    rippleSnapTargetsMs(clip, actions),
    SNAP_THRESHOLD_PX / pxPerMs,
  );
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

  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const busyRef = useRef(false);
  const pxPerMsRef = useRef(0);
  const totalMsRef = useRef(0);
  const clipsRef = useRef(clips);
  const actionsRef = useRef(actions);
  const snapRef = useRef(true);
  const zoomRef = useRef(MIN_ZOOM);
  const zoomAnchorRef = useRef<{ ms: number; clientX: number } | null>(null);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
    target: HTMLElement;
  } | null>(null);

  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [snap, setSnap] = useState(true);
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const [reorderIds, setReorderIds] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pxPerMs = width > 0 && totalMs > 0 ? (width * zoom) / totalMs : 0;
  const contentWidth = width > 0 ? width * zoom : 0;
  pxPerMsRef.current = pxPerMs;
  totalMsRef.current = totalMs;
  clipsRef.current = clips;
  actionsRef.current = actions;
  snapRef.current = snap;
  zoomRef.current = zoom;

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    setWidth(el.getBoundingClientRect().width);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = viewportRef.current;
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

  const selectClipAt = useCallback(
    (source: readonly Clip[], ms: number) => {
      const clip = clipAt(source, ms);
      if (!clip) {
        return;
      }
      const current = useEditor.getState().selection;
      if (current?.type === "clip" && current.id === clip.id) {
        return;
      }
      setSelection({ type: "clip", id: clip.id });
    },
    [setSelection],
  );

  const applyPlayhead = useCallback(
    (ms: number) => {
      const snapped = maybeSnapMs(
        ms,
        snapRef.current,
        pxPerMsRef.current,
        clipsRef.current,
        actionsRef.current,
      );
      const next = clampPlayheadMs(snapped, totalMsRef.current);
      if (useEditor.getState().playheadMs !== next) {
        setPlayheadMs(next);
      }
      selectClipAt(clipsRef.current, next);
    },
    [selectClipAt, setPlayheadMs],
  );

  const alignToPlayhead = useCallback(
    (nextClips: readonly Clip[]) => {
      const ms = clampPlayheadMs(
        useEditor.getState().playheadMs,
        totalDurationMs(nextClips),
      );
      if (useEditor.getState().playheadMs !== ms) {
        setPlayheadMs(ms);
      }
      selectClipAt(nextClips, ms);
    },
    [selectClipAt, setPlayheadMs],
  );

  const stopListening = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) {
      return;
    }
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    listeners.target.removeEventListener("lostpointercapture", listeners.cancel);
    listenersRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    setRubberBand(null);
    setReorderIds(null);
    setDraggingId(null);
  }, []);

  const commitRipple = useCallback(
    async (clipId: string, durationMs: number, originDuration: number) => {
      const snapshot = useEditor.getState().project;
      if (!snapshot || durationMs === originDuration) {
        setRubberBand(null);
        return;
      }
      busyRef.current = true;
      setError(null);
      try {
        const next = await rippleClip(snapshot, clipId, durationMs);
        if (useEditor.getState().project !== snapshot) {
          setError("Timeline edit discarded because the project changed.");
          return;
        }
        setProject(next);
        alignToPlayhead(next.clips);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setRubberBand(null);
        busyRef.current = false;
      }
    },
    [alignToPlayhead, setProject],
  );

  const commitReorder = useCallback(
    async (originIds: string[], nextIds: string[]) => {
      const snapshot = useEditor.getState().project;
      if (!snapshot || sameIds(originIds, nextIds)) {
        clearPreview();
        return;
      }
      busyRef.current = true;
      setError(null);
      try {
        const next = await reorderClips(snapshot, nextIds);
        if (useEditor.getState().project !== snapshot) {
          setError("Timeline edit discarded because the project changed.");
          return;
        }
        setProject(next);
        alignToPlayhead(next.clips);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        clearPreview();
        busyRef.current = false;
      }
    },
    [alignToPlayhead, clearPreview, setProject],
  );

  const onMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      if (drag.kind === "ripple") {
        const durationMs = maybeSnapRipple(
          drag,
          event.clientX,
          pxPerMsRef.current,
          snapRef.current,
          clipsRef.current,
          actionsRef.current,
        );
        drag.durationMs = durationMs;
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
        if (!drag.started) {
          drag.started = true;
          setDraggingId(drag.clipId);
        }
        const ids = reorderIdsAt(drag, clientXToMs(event.clientX));
        drag.orderedIds = ids;
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
        applyPlayhead(clientXToMs(event.clientX));
        return;
      }
      if (drag.kind === "ripple") {
        const durationMs = maybeSnapRipple(
          drag,
          event.clientX,
          pxPerMsRef.current,
          snapRef.current,
          clipsRef.current,
          actionsRef.current,
        );
        void commitRipple(drag.clipId, durationMs, drag.originDuration);
        return;
      }
      if (!drag.started) {
        clearPreview();
        return;
      }
      void commitReorder(
        drag.originIds,
        reorderIdsAt(drag, clientXToMs(event.clientX)),
      );
    },
    [
      applyPlayhead,
      clearPreview,
      clientXToMs,
      commitReorder,
      commitRipple,
      stopListening,
    ],
  );

  const onCancel = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      dragRef.current = null;
      stopListening();
      clearPreview();
    },
    [clearPreview, stopListening],
  );

  const startListening = useCallback(
    (target: HTMLElement) => {
      stopListening();
      listenersRef.current = { move: onMove, up: onUp, cancel: onCancel, target };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      target.addEventListener("lostpointercapture", onCancel);
    },
    [onCancel, onMove, onUp, stopListening],
  );

  useEffect(() => {
    return () => stopListening();
  }, [stopListening]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const viewport = viewportRef.current;
    if (!anchor || !viewport || !(pxPerMs > 0)) {
      return;
    }
    zoomAnchorRef.current = null;
    const viewX = anchor.clientX - viewport.getBoundingClientRect().left;
    viewport.scrollLeft = Math.max(0, anchor.ms * pxPerMs - viewX);
  }, [zoom, pxPerMs, contentWidth]);

  const applyZoomFactor = useCallback(
    (factor: number, anchorClientX?: number) => {
      setZoom((prev) => {
        const clamped = clampZoom(prev * factor);
        if (clamped === prev) {
          return prev;
        }
        const viewport = viewportRef.current;
        if (viewport && pxPerMsRef.current > 0) {
          const clientX =
            anchorClientX ??
            viewport.getBoundingClientRect().left + viewport.clientWidth / 2;
          zoomAnchorRef.current = { ms: clientXToMs(clientX), clientX };
        }
        return clamped;
      });
    },
    [clientXToMs],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        applyZoomFactor(factor, event.clientX);
        return;
      }
      if (
        Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
        zoomRef.current > MIN_ZOOM
      ) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaY;
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyZoomFactor, clips.length]);

  const onScrubPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || busyRef.current || clipsRef.current.length === 0) {
        return;
      }
      event.preventDefault();
      dragRef.current = { kind: "scrub", pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPlayhead(clientXToMs(event.clientX));
      startListening(event.currentTarget);
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
      const originIds = clipsRef.current.map((clip) => clip.id);
      dragRef.current = {
        kind: "reorder",
        clipId,
        fromIndex,
        originIds,
        originClips: clipsRef.current.slice(),
        originX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        orderedIds: originIds,
      };
      startListening(event.currentTarget);
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
        durationMs: clip.durationMs,
      };
      setRubberBand({ clipId, durationMs: clip.durationMs });
      startListening(event.currentTarget);
    },
    [startListening],
  );

  const onSelectClip = useCallback(
    (clipId: string) => {
      const clip = clipsRef.current.find((item) => item.id === clipId);
      if (!clip) {
        return;
      }
      const current = useEditor.getState().selection;
      if (!(current?.type === "clip" && current.id === clipId)) {
        setSelection({ type: "clip", id: clipId });
      }
      const playhead = useEditor.getState().playheadMs;
      if (clipAt(clipsRef.current, playhead)?.id !== clipId) {
        setPlayheadMs(clip.startMs);
      }
    },
    [setPlayheadMs, setSelection],
  );

  const onResizeKey = useCallback(
    (clipId: string, deltaMs: number) => {
      if (busyRef.current) {
        return;
      }
      const clip = clipsRef.current.find((item) => item.id === clipId);
      if (!clip) {
        return;
      }
      onSelectClip(clipId);
      const durationMs = clampClipDurationMs(clip.durationMs + deltaMs);
      void commitRipple(clipId, durationMs, clip.durationMs);
    },
    [commitRipple, onSelectClip],
  );

  const onSelectAction = useCallback(
    (actionId: string, atMs: number) => {
      const current = useEditor.getState().selection;
      if (!(current?.type === "action" && current.id === actionId)) {
        setSelection({ type: "action", id: actionId });
      }
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
    const step = tickStepMs(pxPerMs);
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
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-0.5">
        <button
          type="button"
          onClick={() => applyZoomFactor(1 / ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => applyZoomFactor(ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            zoomAnchorRef.current = null;
            setZoom(MIN_ZOOM);
            const viewport = viewportRef.current;
            if (viewport) {
              viewport.scrollLeft = 0;
            }
          }}
          disabled={zoom === MIN_ZOOM}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
          aria-label="Fit timeline"
        >
          <UnfoldHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span className="px-1 text-[10px] tabular-nums text-zinc-500">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setSnap((prev) => !prev)}
          aria-pressed={snap}
          className={`ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            snap
              ? "bg-sky-500/15 text-sky-300"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          }`}
          aria-label={snap ? "Disable snap" : "Enable snap"}
        >
          <Magnet className="h-3 w-3" aria-hidden />
          Snap
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-12 shrink-0 flex-col border-r border-zinc-800 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          <div className="h-5 border-b border-zinc-800" />
          <div className="flex flex-1 items-center px-1.5">Clips</div>
          <div className="flex h-8 items-center border-t border-zinc-800 px-1.5">
            Keys
          </div>
        </div>
        <div
          ref={viewportRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div
            ref={trackRef}
            className="relative h-full"
            style={{ width: contentWidth > 0 ? contentWidth : "100%" }}
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
                onResizeKey={onResizeKey}
                resizeStepMs={RESIZE_STEP_MS}
              />
            </div>
            <div className="absolute inset-x-0 bottom-0 h-8">
              <ActionTrack
                actions={actions}
                pxPerMs={pxPerMs}
                totalMs={totalMs}
                selectedId={selectedActionId}
                onSelect={onSelectAction}
              />
            </div>
            <Playhead ms={playheadMs} pxPerMs={pxPerMs} />
          </div>
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
