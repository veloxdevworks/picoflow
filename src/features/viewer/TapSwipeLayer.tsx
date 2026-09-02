import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  actionAtPlayhead,
  appendAction,
  swipeAction,
  tapAction,
} from "../../lib/actions";
import {
  containRect,
  isSwipeGesture,
  pointerToNormalized,
  type Rect,
} from "../../lib/coords";
import { actionOnClip, clipAt, totalDurationMs } from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import type { Action, Point } from "../../types/generated";

const EMPTY_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

type Gesture = {
  pointerId: number;
  origin: Point;
  originClient: Point;
  current: Point;
  swiping: boolean;
};

export function TapSwipeLayer({
  imageWidth,
  imageHeight,
}: {
  imageWidth: number;
  imageHeight: number;
}) {
  const project = useEditor((s) => s.project);
  const playheadMs = useEditor((s) => s.playheadMs);
  const selection = useEditor((s) => s.selection);
  const updateProject = useEditor((s) => s.updateProject);
  const setSelection = useEditor((s) => s.setSelection);

  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [stageBox, setStageBox] = useState<Rect>(EMPTY_RECT);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    setStageBox({ left: 0, top: 0, width: r.width, height: r.height });
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, imageWidth, imageHeight]);

  const clip = project ? clipAt(project.clips, playheadMs) : undefined;
  const actions = project && clip
    ? project.actions.filter((action) => actionOnClip(action, clip))
    : [];
  const selectedId = selection?.type === "action" ? selection.id : null;

  const displayed = containRect(stageBox, imageWidth, imageHeight);

  const pointFromEvent = useCallback((clientX: number, clientY: number): Point => {
    const el = overlayRef.current;
    if (!el) {
      return { x: 0, y: 0 };
    }
    return pointerToNormalized(clientX, clientY, el.getBoundingClientRect());
  }, []);

  const commit = useCallback(
    (draft: Gesture) => {
      const current = useEditor.getState().project;
      if (!current || current.clips.length === 0) {
        return;
      }
      const atMs = actionAtPlayhead(
        useEditor.getState().playheadMs,
        totalDurationMs(current.clips),
      );
      const action = draft.swiping
        ? swipeAction(atMs, draft.origin, draft.current)
        : tapAction(atMs, draft.origin.x, draft.origin.y);
      updateProject((project) => appendAction(project, action));
      setSelection({ type: "action", id: action.id });
    },
    [setSelection, updateProject],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const origin = pointFromEvent(event.clientX, event.clientY);
      const next: Gesture = {
        pointerId: event.pointerId,
        origin,
        originClient: { x: event.clientX, y: event.clientY },
        current: origin,
        swiping: false,
      };
      gestureRef.current = next;
      setGesture(next);
    },
    [pointFromEvent],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const draft = gestureRef.current;
      if (!draft || draft.pointerId !== event.pointerId) {
        return;
      }
      const current = pointFromEvent(event.clientX, event.clientY);
      const swiping =
        draft.swiping ||
        isSwipeGesture(
          event.clientX - draft.originClient.x,
          event.clientY - draft.originClient.y,
        );
      const next = { ...draft, current, swiping };
      gestureRef.current = next;
      setGesture(next);
    },
    [pointFromEvent],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const draft = gestureRef.current;
      if (!draft || draft.pointerId !== event.pointerId) {
        return;
      }
      gestureRef.current = null;
      setGesture(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const current = pointFromEvent(event.clientX, event.clientY);
      const swiping =
        draft.swiping ||
        isSwipeGesture(
          event.clientX - draft.originClient.x,
          event.clientY - draft.originClient.y,
        );
      commit({ ...draft, current, swiping });
    },
    [commit, pointFromEvent],
  );

  const abortGesture = useCallback((pointerId: number) => {
    const draft = gestureRef.current;
    if (!draft || draft.pointerId !== pointerId) {
      return;
    }
    gestureRef.current = null;
    setGesture(null);
  }, []);

  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    return null;
  }

  return (
    <div ref={stageRef} className="pointer-events-none absolute inset-0">
      {displayed.width > 0 && displayed.height > 0 ? (
        <div
          ref={overlayRef}
          className="absolute cursor-crosshair touch-none"
          style={{
            left: displayed.left,
            top: displayed.top,
            width: displayed.width,
            height: displayed.height,
            pointerEvents: "auto",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(event) => abortGesture(event.pointerId)}
          onLostPointerCapture={(event) => abortGesture(event.pointerId)}
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden
          >
            {actions.map((action) => (
              <ActionOverlay
                key={action.id}
                action={action}
                selected={action.id === selectedId}
              />
            ))}
            {gesture?.swiping ? (
              <line
                x1={gesture.origin.x}
                y1={gesture.origin.y}
                x2={gesture.current.x}
                y2={gesture.current.y}
                className="stroke-sky-300"
                style={{ vectorEffect: "non-scaling-stroke", strokeWidth: 2 }}
              />
            ) : null}
          </svg>
          {actions.map((action) => (
            <ActionHandle
              key={action.id}
              action={action}
              selected={action.id === selectedId}
              onSelect={() => setSelection({ type: "action", id: action.id })}
            />
          ))}
          {gesture && !gesture.swiping ? (
            <span
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-300 bg-sky-400/80"
              style={{
                left: `${gesture.origin.x * 100}%`,
                top: `${gesture.origin.y * 100}%`,
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionOverlay({ action, selected }: { action: Action; selected: boolean }) {
  const stroke = selected ? "stroke-sky-300" : "stroke-white/70";
  const style = { vectorEffect: "non-scaling-stroke" as const, strokeWidth: selected ? 2 : 1.5 };
  if (action.type === "swipe") {
    return (
      <line
        x1={action.x0}
        y1={action.y0}
        x2={action.x1}
        y2={action.y1}
        className={stroke}
        style={style}
      />
    );
  }
  return null;
}

function ActionHandle({
  action,
  selected,
  onSelect,
}: {
  action: Action;
  selected: boolean;
  onSelect: () => void;
}) {
  const points = handlePoints(action);
  if (points.length === 0) {
    return null;
  }
  return (
    <>
      {points.map((point, index) => (
        <button
          key={`${action.id}:${index}`}
          type="button"
          aria-label={selected ? `Selected ${action.type}` : `Select ${action.type}`}
          className={`absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 touch-none ${
            selected
              ? "border-sky-300 bg-sky-400"
              : "border-white/80 bg-zinc-950/80 hover:border-sky-200"
          }`}
          style={{
            left: `${point.x * 100}%`,
            top: `${point.y * 100}%`,
            pointerEvents: "auto",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect();
          }}
        />
      ))}
    </>
  );
}

function handlePoints(action: Action): Point[] {
  if (action.type === "tap") {
    return [{ x: action.x, y: action.y }];
  }
  if (action.type === "swipe") {
    return [
      { x: action.x0, y: action.y0 },
      { x: action.x1, y: action.y1 },
    ];
  }
  if (action.type === "mouse_move" && action.x !== undefined && action.y !== undefined) {
    return [{ x: action.x, y: action.y }];
  }
  return [];
}
