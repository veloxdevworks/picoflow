import type { ReactNode } from "react";
import {
  Clock,
  Keyboard,
  Mouse,
  MousePointerClick,
  Move,
  MoveHorizontal,
} from "lucide-react";
import type { Action } from "../../types/generated";

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

function actionLabel(action: Action): string {
  switch (action.type) {
    case "tap":
      return "Tap";
    case "swipe":
      return "Swipe";
    case "key":
      return "Key";
    case "mouse_move":
      return "Mouse move";
    case "mouse_button":
      return "Mouse button";
    case "wait":
      return "Wait";
  }
}

export function ActionTrack({
  actions,
  pxPerMs,
  selectedId,
  onSelect,
}: {
  actions: readonly Action[];
  pxPerMs: number;
  selectedId: string | null;
  onSelect: (actionId: string, atMs: number) => void;
}) {
  return (
    <div className="relative h-full border-t border-zinc-800 bg-zinc-950/60">
      {actions.map((action) => {
        const selected = selectedId === action.id;
        return (
          <button
            key={action.id}
            type="button"
            title={`${actionLabel(action)} · ${action.atMs} ms`}
            aria-label={`${actionLabel(action)} at ${action.atMs} ms`}
            aria-pressed={selected}
            className={`absolute top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border touch-none ${
              selected
                ? "border-sky-300 bg-sky-500 text-white"
                : "border-zinc-600 bg-zinc-800 text-zinc-300 hover:border-zinc-400"
            }`}
            style={{ left: action.atMs * pxPerMs }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0) {
                return;
              }
              onSelect(action.id, action.atMs);
            }}
          >
            {actionIcon(action)}
          </button>
        );
      })}
    </div>
  );
}
