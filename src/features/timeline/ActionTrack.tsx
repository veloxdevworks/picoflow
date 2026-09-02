import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Clock,
  Keyboard,
  Mouse,
  MousePointerClick,
  Move,
  MoveHorizontal,
} from "lucide-react";
import { actionLabel } from "../../lib/actions";
import { clampActionAtMs, upcomingKeyframe } from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import type { Action } from "../../types/generated";

const KEYFRAME_SLOP_PX = 3;

type Drag = {
  actionId: string;
  pointerId: number;
  originX: number;
  originAtMs: number;
  atMs: number;
  started: boolean;
};

function actionIcon(action: Action): ReactNode {
  const cls = "h-3 w-3";
  switch (action.type) {
    case "tap":
      return <MousePointerClick className={cls} aria-hidden />;
    case "swipe":
      return <MoveHorizontal className={cls} aria-hidden />;
    case "key":
      return <Keyboard className={cls} aria-hidden />;
    case "mouse_move":
      return <Move className={cls} aria-hidden />;
    case "mouse_button":
      return <Mouse className={cls} aria-hidden />;
    case "wait":
      return <Clock className={cls} aria-hidden />;
  }
}

export function ActionTrack({
  actions,
  pxPerMs,
  totalMs,
  selectedId,
  onSelect,
}: {
  actions: readonly Action[];
  pxPerMs: number;
  totalMs: number;
  selectedId: string | null;
  onSelect: (actionId: string, atMs: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; atMs: number } | null>(null);
  const updateProject = useEditor((s) => s.updateProject);
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const upcomingId = upcomingKeyframe(actions, playheadMs)?.id ?? null;

  function clientXToAtMs(clientX: number): number {
    const el = trackRef.current;
    if (!el || !(pxPerMs > 0)) {
      return 0;
    }
    return clampActionAtMs(
      (clientX - el.getBoundingClientRect().left) / pxPerMs,
      totalMs,
    );
  }

  function onMove(event: ReactPointerEvent<HTMLElement>, action: Action) {
    const drag = dragRef.current;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.actionId !== action.id ||
      useEditor.getState().playing
    ) {
      return;
    }
    if (
      !drag.started &&
      Math.abs(event.clientX - drag.originX) < KEYFRAME_SLOP_PX
    ) {
      return;
    }
    drag.started = true;
    const atMs = clientXToAtMs(event.clientX);
    drag.atMs = atMs;
    setPreview({ id: action.id, atMs });
    onSelect(action.id, atMs);
  }

  function abortDrag() {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    dragRef.current = null;
    setPreview(null);
    if (!useEditor.getState().playing) {
      onSelect(drag.actionId, drag.originAtMs);
    }
  }

  useEffect(() => {
    if (playing) {
      abortDrag();
    }
  }, [playing]);

  function onUp(event: ReactPointerEvent<HTMLElement>, action: Action) {
    const drag = dragRef.current;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.actionId !== action.id ||
      useEditor.getState().playing
    ) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const atMs = drag.started ? clientXToAtMs(event.clientX) : drag.originAtMs;
    setPreview(null);
    onSelect(action.id, atMs);
    if (!drag.started || atMs === drag.originAtMs) {
      return;
    }
    updateProject((project) => ({
      ...project,
      actions: project.actions.map((item) =>
        item.id === action.id ? { ...item, atMs } : item,
      ),
    }));
  }

  return (
    <div
      ref={trackRef}
      className="relative h-full border-t border-zinc-800 bg-zinc-950/60"
    >
      {actions.map((action) => {
        const selected = selectedId === action.id;
        const upcoming = upcomingId === action.id;
        const atMs = preview?.id === action.id ? preview.atMs : action.atMs;
        return (
          <button
            key={action.id}
            type="button"
            title={`${upcoming && !selected ? "Next · " : ""}${actionLabel(action)} · ${atMs} ms`}
            aria-label={`${upcoming && !selected ? "Next " : ""}${actionLabel(action)} at ${atMs} ms`}
            aria-pressed={selected}
            className={`absolute top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border touch-none ${
              playing ? "cursor-default" : "cursor-ew-resize"
            } ${
              selected
                ? "border-sky-300 bg-sky-500 text-white"
                : upcoming
                  ? "border-amber-300 bg-amber-500 text-white"
                  : "border-zinc-600 bg-zinc-800 text-zinc-300 hover:border-zinc-400"
            }`}
            style={{ left: atMs * pxPerMs }}
            onPointerDown={(event) => {
              if (playing || event.button !== 0) {
                return;
              }
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                actionId: action.id,
                pointerId: event.pointerId,
                originX: event.clientX,
                originAtMs: action.atMs,
                atMs: action.atMs,
                started: false,
              };
              onSelect(action.id, action.atMs);
            }}
            onPointerMove={(event) => onMove(event, action)}
            onPointerUp={(event) => onUp(event, action)}
            onPointerCancel={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) {
                return;
              }
              abortDrag();
            }}
            onLostPointerCapture={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) {
                return;
              }
              abortDrag();
            }}
          >
            {actionIcon(action)}
          </button>
        );
      })}
    </div>
  );
}
