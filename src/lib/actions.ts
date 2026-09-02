import { clamp01 } from "./coords";
import { newId } from "./ids";
import { clampActionAtMs } from "./timeline";
import type {
  Action,
  Modifier,
  MouseButton,
  MouseOp,
  Point,
  Project,
} from "../types/generated";

/** Matches `picoflow_core::DEFAULT_TAP_HOLD_MS`. */
export const DEFAULT_TAP_HOLD_MS = 60;
/** Matches `picoflow_core::DEFAULT_KEY_HOLD_MS`. */
export const DEFAULT_KEY_HOLD_MS = 50;
/** Matches design default swipe `duration_ms`. */
export const DEFAULT_SWIPE_DURATION_MS = 400;
/** Matches `picoflow_core::MIN_SWIPE_DURATION_MS`. */
export const MIN_SWIPE_DURATION_MS = 16;
export const DEFAULT_WAIT_DURATION_MS = 500;
export const DEFAULT_KEYCODE = "ENTER";

export type ActionType = Action["type"];

export function appendAction(project: Project, action: Action): Project {
  return { ...project, actions: [...project.actions, action] };
}

export function replaceAction(project: Project, action: Action): Project {
  return {
    ...project,
    actions: project.actions.map((item) => (item.id === action.id ? action : item)),
  };
}

export function removeAction(project: Project, actionId: string): Project {
  return {
    ...project,
    actions: project.actions.filter((item) => item.id !== actionId),
  };
}

export function tapAction(atMs: number, x: number, y: number): Action {
  return {
    id: newId(),
    atMs,
    type: "tap",
    x: clamp01(x),
    y: clamp01(y),
    holdMs: DEFAULT_TAP_HOLD_MS,
  };
}

export function swipeAction(
  atMs: number,
  from: Point,
  to: Point,
  durationMs = DEFAULT_SWIPE_DURATION_MS,
): Action {
  return {
    id: newId(),
    atMs,
    type: "swipe",
    x0: clamp01(from.x),
    y0: clamp01(from.y),
    x1: clamp01(to.x),
    y1: clamp01(to.y),
    durationMs: Math.max(MIN_SWIPE_DURATION_MS, Math.round(durationMs)),
  };
}

export function keycodeAction(atMs: number, keycode = DEFAULT_KEYCODE): Action {
  return {
    id: newId(),
    atMs,
    type: "key",
    keycode,
    holdMs: DEFAULT_KEY_HOLD_MS,
  };
}

export function charsAction(atMs: number, chars: string): Action {
  return {
    id: newId(),
    atMs,
    type: "key",
    chars,
    holdMs: DEFAULT_KEY_HOLD_MS,
  };
}

export function mouseMoveAbsoluteAction(atMs: number, x: number, y: number): Action {
  return {
    id: newId(),
    atMs,
    type: "mouse_move",
    x: clamp01(x),
    y: clamp01(y),
  };
}

export function mouseMoveRelativeAction(atMs: number, dx: number, dy: number): Action {
  return {
    id: newId(),
    atMs,
    type: "mouse_move",
    dx,
    dy,
  };
}

export function mouseButtonAction(
  atMs: number,
  button: MouseButton = "left",
  op: MouseOp = "click",
): Action {
  return { id: newId(), atMs, type: "mouse_button", button, op };
}

export function waitAction(atMs: number, durationMs: number): Action {
  return {
    id: newId(),
    atMs,
    type: "wait",
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

export type KeyAction = Extract<Action, { type: "key" }>;
export type MouseMoveAction = Extract<Action, { type: "mouse_move" }>;

function keyHoldAndMods(action: KeyAction): {
  holdMs: number;
  modifiers?: Modifier[];
} {
  const next: { holdMs: number; modifiers?: Modifier[] } = {
    holdMs: action.holdMs,
  };
  if (action.modifiers && action.modifiers.length > 0) {
    next.modifiers = action.modifiers;
  }
  return next;
}

/** Exclusive: keycode XOR chars. Rebuilds so save_project can validate. */
export function keyWithKeycode(action: KeyAction, keycode: string): KeyAction {
  return {
    id: action.id,
    atMs: action.atMs,
    type: "key",
    keycode,
    ...keyHoldAndMods(action),
  };
}

export function keyWithChars(action: KeyAction, chars: string): KeyAction {
  return {
    id: action.id,
    atMs: action.atMs,
    type: "key",
    chars,
    ...keyHoldAndMods(action),
  };
}

export function keyWithHoldMs(action: KeyAction, holdMs: number): KeyAction {
  const next = action.keycode
    ? keyWithKeycode(action, action.keycode)
    : keyWithChars(action, action.chars ?? "");
  return { ...next, holdMs: Math.max(0, Math.round(holdMs)) };
}

export function keyWithModifiers(action: KeyAction, modifiers: Modifier[]): KeyAction {
  const base = action.keycode
    ? keyWithKeycode({ ...action, modifiers: undefined }, action.keycode)
    : keyWithChars({ ...action, modifiers: undefined }, action.chars ?? "");
  if (modifiers.length === 0) {
    return base;
  }
  return { ...base, modifiers };
}

export function mouseMoveAbsolute(
  action: MouseMoveAction,
  x: number,
  y: number,
): MouseMoveAction {
  return {
    id: action.id,
    atMs: action.atMs,
    type: "mouse_move",
    x: clamp01(x),
    y: clamp01(y),
  };
}

export function mouseMoveRelative(
  action: MouseMoveAction,
  dx: number,
  dy: number,
): MouseMoveAction {
  return {
    id: action.id,
    atMs: action.atMs,
    type: "mouse_move",
    dx,
    dy,
  };
}

export function pointFromAction(action: Action): Point {
  if (action.type === "tap") {
    return { x: action.x, y: action.y };
  }
  if (action.type === "swipe") {
    return { x: action.x0, y: action.y0 };
  }
  if (
    action.type === "mouse_move" &&
    action.x !== undefined &&
    action.y !== undefined
  ) {
    return { x: action.x, y: action.y };
  }
  return { x: 0.5, y: 0.5 };
}

export function convertAction(action: Action, type: ActionType): Action {
  const { id, atMs } = action;
  const point = pointFromAction(action);
  switch (type) {
    case "tap":
      return { id, atMs, type: "tap", x: point.x, y: point.y, holdMs: DEFAULT_TAP_HOLD_MS };
    case "swipe":
      return {
        id,
        atMs,
        type: "swipe",
        x0: point.x,
        y0: point.y,
        x1: point.x,
        y1: point.y,
        durationMs: DEFAULT_SWIPE_DURATION_MS,
      };
    case "key":
      return { id, atMs, type: "key", keycode: DEFAULT_KEYCODE, holdMs: DEFAULT_KEY_HOLD_MS };
    case "mouse_move":
      return { id, atMs, type: "mouse_move", x: point.x, y: point.y };
    case "mouse_button":
      return { id, atMs, type: "mouse_button", button: "left", op: "click" };
    case "wait":
      return { id, atMs, type: "wait", durationMs: DEFAULT_WAIT_DURATION_MS };
  }
}

export function actionAtPlayhead(playheadMs: number, totalMs: number): number {
  return clampActionAtMs(playheadMs, totalMs);
}

export function actionLabel(action: Action): string {
  switch (action.type) {
    case "tap":
      return "Tap";
    case "swipe":
      return "Swipe";
    case "key":
      if (action.keycode) {
        return `Key ${action.keycode}`;
      }
      if (action.chars) {
        return `Key "${action.chars}"`;
      }
      return "Key";
    case "mouse_move":
      return "Mouse move";
    case "mouse_button":
      return "Mouse button";
    case "wait":
      return "Wait";
  }
}
