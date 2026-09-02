import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight } from "lucide-react";
import {
  actionAtPlayhead,
  actionLabel,
  appendAction,
  charsAction,
  convertAction,
  DEFAULT_WAIT_DURATION_MS,
  MIN_SWIPE_DURATION_MS,
  keycodeAction,
  keyWithChars,
  keyWithHoldMs,
  keyWithKeycode,
  keyWithModifiers,
  mouseButtonAction,
  mouseMoveAbsolute,
  mouseMoveAbsoluteAction,
  mouseMoveRelative,
  mouseMoveRelativeAction,
  removeAction,
  replaceAction,
  type ActionType,
} from "../../lib/actions";
import { clamp01 } from "../../lib/coords";
import { liveClamped, parseIntValue, parseMs, parseNumber } from "../../lib/parse";
import { clampActionAtMs, totalDurationMs } from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import { errorMessage, insertWait } from "../../types/commands";
import type {
  Action,
  Clip,
  Modifier,
  MouseButton,
  MouseOp,
  Photo,
} from "../../types/generated";
import { KeyPicker } from "./KeyPicker";

const ACTION_TYPES: { type: ActionType; label: string }[] = [
  { type: "tap", label: "Tap" },
  { type: "swipe", label: "Swipe" },
  { type: "key", label: "Key" },
  { type: "mouse_move", label: "Mouse move" },
  { type: "mouse_button", label: "Mouse button" },
  { type: "wait", label: "Wait" },
];

const MODIFIERS: { id: Modifier; label: string }[] = [
  { id: "ctrl", label: "Ctrl" },
  { id: "shift", label: "Shift" },
  { id: "alt", label: "Alt" },
  { id: "gui", label: "GUI" },
];

const INPUT_CLASS =
  "w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500 disabled:opacity-50";

function photoLabel(photo: Photo | undefined, fallback: string): string {
  if (!photo) {
    return fallback;
  }
  const path = photo.warpedPath ?? photo.rawPath;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || photo.id;
}

export function Inspector() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  const setProject = useEditor((s) => s.setProject);
  const updateProject = useEditor((s) => s.updateProject);
  const setSelection = useEditor((s) => s.setSelection);

  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitMs, setWaitMs] = useState(String(DEFAULT_WAIT_DURATION_MS));

  const clip =
    project && selection?.type === "clip"
      ? project.clips.find((item) => item.id === selection.id)
      : undefined;
  const action =
    project && selection?.type === "action"
      ? project.actions.find((item) => item.id === selection.id)
      : undefined;
  const photo =
    project && selection?.type === "photo"
      ? project.photos.find((item) => item.id === selection.id)
      : undefined;
  const clipPhoto =
    project && clip
      ? project.photos.find((item) => item.id === clip.photoId)
      : undefined;

  const commitAction = useCallback(
    (next: Action) => {
      if (useEditor.getState().playing) {
        return;
      }
      updateProject((current) => replaceAction(current, next));
    },
    [updateProject],
  );

  const addAction = useCallback(
    (create: (atMs: number) => Action) => {
      const current = useEditor.getState().project;
      if (!current || current.clips.length === 0 || useEditor.getState().playing) {
        return;
      }
      const atMs = actionAtPlayhead(
        useEditor.getState().playheadMs,
        totalDurationMs(current.clips),
      );
      const next = create(atMs);
      updateProject((project) => appendAction(project, next));
      setSelection({ type: "action", id: next.id });
      setError(null);
    },
    [setSelection, updateProject],
  );

  const onInsertWait = useCallback(async () => {
    const snapshot = useEditor.getState().project;
    if (
      !snapshot ||
      snapshot.clips.length === 0 ||
      busyRef.current ||
      useEditor.getState().playing
    ) {
      return;
    }
    const durationMs = parseMs(waitMs) ?? DEFAULT_WAIT_DURATION_MS;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await insertWait(
        snapshot,
        useEditor.getState().playheadMs,
        durationMs,
      );
      if (useEditor.getState().project !== snapshot) {
        setError("Wait insert discarded because the project changed.");
        return;
      }
      setProject(next);
      const known = new Set(snapshot.actions.map((item) => item.id));
      const added = next.actions.find((item) => !known.has(item.id));
      if (added) {
        setSelection({ type: "action", id: added.id });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [setProject, setSelection, waitMs]);

  const onDeleteAction = useCallback(() => {
    if (!action || useEditor.getState().playing) {
      return;
    }
    const id = action.id;
    updateProject((current) => removeAction(current, id));
    const latest = useEditor.getState();
    if (latest.selection?.type === "action" && latest.selection.id === id) {
      setSelection(null);
    }
  }, [action, setSelection, updateProject]);

  if (!project) {
    return (
      <Empty
        icon={<PanelRight className="h-5 w-5" aria-hidden />}
        label="Inspector"
        hint="Open a project, then select a clip or action."
      />
    );
  }

  const hasClips = project.clips.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-800 px-3 py-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Inspector
        </p>
        <p className="truncate text-xs text-zinc-400">
          {action
            ? actionLabel(action)
            : clip
              ? "Clip"
              : photo
                ? "Photo"
                : "Nothing selected"}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {action ? (
          <fieldset
            disabled={playing}
            className="min-w-0 border-0 p-0 disabled:opacity-60"
          >
            <ActionFields
              action={action}
              totalMs={totalDurationMs(project.clips)}
              onChange={commitAction}
              onDelete={onDeleteAction}
            />
          </fieldset>
        ) : clip ? (
          <ClipFields clip={clip} photo={clipPhoto} />
        ) : photo ? (
          <PhotoFields photo={photo} />
        ) : (
          <p className="text-xs leading-relaxed text-zinc-600">
            Select a clip or action, or click the warped view to add a tap.
          </p>
        )}
        {hasClips ? (
          <div className="mt-4 border-t border-zinc-800 pt-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Add at playhead
            </p>
            <div className="flex flex-wrap gap-1.5">
              <AddButton
                disabled={busy || playing}
                label="Key"
                onClick={() => addAction((atMs) => keycodeAction(atMs))}
              />
              <AddButton
                disabled={busy || playing}
                label="Text"
                onClick={() => addAction((atMs) => charsAction(atMs, "ok"))}
              />
              <AddButton
                disabled={busy || playing}
                label="Mouse move"
                onClick={() => addAction((atMs) => mouseMoveAbsoluteAction(atMs, 0.5, 0.5))}
              />
              <AddButton
                disabled={busy || playing}
                label="Mouse rel"
                onClick={() => addAction((atMs) => mouseMoveRelativeAction(atMs, 0, 0))}
              />
              <AddButton
                disabled={busy || playing}
                label="Click"
                onClick={() => addAction((atMs) => mouseButtonAction(atMs))}
              />
            </div>
            <div className="mt-2 flex items-end gap-2">
              <Field label="Wait ms">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={waitMs}
                  disabled={busy || playing}
                  aria-label="Wait duration in milliseconds"
                  className={INPUT_CLASS}
                  onChange={(event) => setWaitMs(event.target.value)}
                />
              </Field>
              <button
                type="button"
                disabled={busy || playing}
                onClick={() => void onInsertWait()}
                className="mb-px shrink-0 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                Insert wait
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
              Wait marks a pause. Timing is the gap before the next keyframe
              (atMs); the device does not sleep durationMs on top of that.
            </p>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="truncate px-3 pb-2 text-xs text-red-400" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ClipFields({ clip, photo }: { clip: Clip; photo: Photo | undefined }) {
  return (
    <div className="flex flex-col gap-2">
      <Field label="Photo">
        <p className="truncate text-xs text-zinc-200">{photoLabel(photo, clip.photoId)}</p>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start">
          <p className="text-xs text-zinc-200">{clip.startMs} ms</p>
        </Field>
        <Field label="Duration">
          <p className="text-xs text-zinc-200">{clip.durationMs} ms</p>
        </Field>
      </div>
    </div>
  );
}

function PhotoFields({ photo }: { photo: Photo }) {
  return (
    <div className="flex flex-col gap-2">
      <Field label="File">
        <p className="truncate text-xs text-zinc-200">{photoLabel(photo, photo.id)}</p>
      </Field>
      <Field label="Size">
        <p className="text-xs text-zinc-200">
          {photo.width} × {photo.height}
        </p>
      </Field>
      <Field label="Normalized">
        <p className="text-xs text-zinc-200">{photo.normalized ? "Yes" : "No"}</p>
      </Field>
    </div>
  );
}

function ActionFields({
  action,
  totalMs,
  onChange,
  onDelete,
}: {
  action: Action;
  totalMs: number;
  onChange: (action: Action) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field label="Type">
        <select
          className={INPUT_CLASS}
          value={action.type}
          aria-label="Action type"
          onChange={(event) =>
            onChange(convertAction(action, event.target.value as ActionType))
          }
        >
          {ACTION_TYPES.map((item) => (
            <option key={item.type} value={item.type}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="atMs">
        <NumberField
          value={action.atMs}
          min={0}
          step={1}
          ariaLabel="atMs"
          parse={parseMs}
          clamp={(n) => clampActionAtMs(n, totalMs)}
          onCommit={(atMs) => onChange({ ...action, atMs })}
        />
      </Field>
      {action.type === "tap" ? <TapFields action={action} onChange={onChange} /> : null}
      {action.type === "swipe" ? (
        <SwipeFields action={action} onChange={onChange} />
      ) : null}
      {action.type === "key" ? <KeyFields action={action} onChange={onChange} /> : null}
      {action.type === "mouse_move" ? (
        <MouseMoveFields action={action} onChange={onChange} />
      ) : null}
      {action.type === "mouse_button" ? (
        <MouseButtonFields action={action} onChange={onChange} />
      ) : null}
      {action.type === "wait" ? (
        <WaitFields action={action} onChange={onChange} />
      ) : null}
      <button
        type="button"
        onClick={onDelete}
        className="mt-2 rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-red-500/40 hover:text-red-300"
      >
        Delete action
      </button>
    </div>
  );
}

function TapFields({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "tap" }>;
  onChange: (action: Action) => void;
}) {
  return (
    <>
      <CoordPair
        x={action.x}
        y={action.y}
        xLabel="x"
        yLabel="y"
        onChange={(x, y) => onChange({ ...action, x, y })}
      />
      <Field label="holdMs">
        <NumberField
          value={action.holdMs}
          min={0}
          ariaLabel="holdMs"
          parse={parseMs}
          onCommit={(holdMs) => onChange({ ...action, holdMs })}
        />
      </Field>
    </>
  );
}

function SwipeFields({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "swipe" }>;
  onChange: (action: Action) => void;
}) {
  return (
    <>
      <CoordPair
        x={action.x0}
        y={action.y0}
        xLabel="x0"
        yLabel="y0"
        onChange={(x0, y0) => onChange({ ...action, x0, y0 })}
      />
      <CoordPair
        x={action.x1}
        y={action.y1}
        xLabel="x1"
        yLabel="y1"
        onChange={(x1, y1) => onChange({ ...action, x1, y1 })}
      />
      <Field label="durationMs">
        <NumberField
          value={action.durationMs}
          min={MIN_SWIPE_DURATION_MS}
          ariaLabel="durationMs"
          parse={parseMs}
          clamp={(n) => Math.max(MIN_SWIPE_DURATION_MS, n)}
          onCommit={(durationMs) => onChange({ ...action, durationMs })}
        />
      </Field>
    </>
  );
}

function KeyFields({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "key" }>;
  onChange: (action: Action) => void;
}) {
  const keycodeMode = Boolean(action.keycode);
  const modifiers = action.modifiers ?? [];
  return (
    <>
      <Field label="Input">
        <div className="flex gap-1">
          <ModeButton
            active={keycodeMode}
            label="Keycode"
            onClick={() => onChange(keyWithKeycode(action, action.keycode || "ENTER"))}
          />
          <ModeButton
            active={!keycodeMode}
            label="Chars"
            onClick={() => onChange(keyWithChars(action, action.chars || "ok"))}
          />
        </div>
      </Field>
      {keycodeMode ? (
        <Field label="keycode">
          <KeyPicker
            value={action.keycode ?? ""}
            onChange={(keycode) => onChange(keyWithKeycode(action, keycode))}
          />
        </Field>
      ) : (
        <Field label="chars">
          <CharsInput
            value={action.chars ?? ""}
            onCommit={(chars) => onChange(keyWithChars(action, chars))}
          />
        </Field>
      )}
      <Field label="Modifiers">
        <div className="flex flex-wrap gap-1.5">
          {MODIFIERS.map((item) => {
            const on = modifiers.includes(item.id);
            return (
              <ModeButton
                key={item.id}
                active={on}
                label={item.label}
                onClick={() => {
                  const next = on
                    ? modifiers.filter((m) => m !== item.id)
                    : [...modifiers, item.id];
                  onChange(keyWithModifiers(action, next));
                }}
              />
            );
          })}
        </div>
      </Field>
      <Field label="holdMs">
        <NumberField
          value={action.holdMs}
          min={0}
          ariaLabel="holdMs"
          parse={parseMs}
          onCommit={(holdMs) => onChange(keyWithHoldMs(action, holdMs))}
        />
      </Field>
    </>
  );
}

function MouseMoveFields({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "mouse_move" }>;
  onChange: (action: Action) => void;
}) {
  const absolute = action.x !== undefined && action.y !== undefined;
  return (
    <>
      <Field label="Mode">
        <div className="flex gap-1">
          <ModeButton
            active={absolute}
            label="Absolute"
            onClick={() =>
              onChange(mouseMoveAbsolute(action, action.x ?? 0.5, action.y ?? 0.5))
            }
          />
          <ModeButton
            active={!absolute}
            label="Relative"
            onClick={() =>
              onChange(mouseMoveRelative(action, action.dx ?? 0, action.dy ?? 0))
            }
          />
        </div>
      </Field>
      {absolute ? (
        <CoordPair
          x={action.x ?? 0}
          y={action.y ?? 0}
          xLabel="x"
          yLabel="y"
          onChange={(x, y) => onChange(mouseMoveAbsolute(action, x, y))}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="dx">
            <NumberField
              value={action.dx ?? 0}
              step={1}
              ariaLabel="dx"
              parse={parseIntValue}
              onCommit={(dx) => onChange(mouseMoveRelative(action, dx, action.dy ?? 0))}
            />
          </Field>
          <Field label="dy">
            <NumberField
              value={action.dy ?? 0}
              step={1}
              ariaLabel="dy"
              parse={parseIntValue}
              onCommit={(dy) => onChange(mouseMoveRelative(action, action.dx ?? 0, dy))}
            />
          </Field>
        </div>
      )}
    </>
  );
}

function MouseButtonFields({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "mouse_button" }>;
  onChange: (action: Action) => void;
}) {
  return (
    <>
      <Field label="Button">
        <select
          className={INPUT_CLASS}
          value={action.button}
          aria-label="Mouse button"
          onChange={(event) =>
            onChange({ ...action, button: event.target.value as MouseButton })
          }
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="middle">Middle</option>
        </select>
      </Field>
      <Field label="Op">
        <select
          className={INPUT_CLASS}
          value={action.op}
          aria-label="Mouse op"
          onChange={(event) =>
            onChange({ ...action, op: event.target.value as MouseOp })
          }
        >
          <option value="click">Click</option>
          <option value="down">Down</option>
          <option value="up">Up</option>
        </select>
      </Field>
    </>
  );
}

function WaitFields({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "wait" }>;
  onChange: (action: Action) => void;
}) {
  return (
    <Field label="durationMs">
      <NumberField
        value={action.durationMs}
        min={0}
        ariaLabel="durationMs"
        parse={parseMs}
        onCommit={(durationMs) => onChange({ ...action, durationMs })}
      />
    </Field>
  );
}

function CoordPair({
  x,
  y,
  xLabel,
  yLabel,
  onChange,
}: {
  x: number;
  y: number;
  xLabel: string;
  yLabel: string;
  onChange: (x: number, y: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={xLabel}>
        <NumberField
          value={x}
          min={0}
          max={1}
          step={0.01}
          ariaLabel={xLabel}
          parse={parseNumber}
          clamp={clamp01}
          onCommit={(next) => onChange(next, y)}
        />
      </Field>
      <Field label={yLabel}>
        <NumberField
          value={y}
          min={0}
          max={1}
          step={0.01}
          ariaLabel={yLabel}
          parse={parseNumber}
          clamp={clamp01}
          onCommit={(next) => onChange(x, next)}
        />
      </Field>
    </div>
  );
}

function NumberField({
  value,
  onCommit,
  parse,
  clamp,
  min,
  max,
  step,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  parse: (raw: string) => number | null;
  clamp?: (n: number) => number;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
}) {
  const focusedRef = useRef(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  function commit(raw: string, finalize: boolean) {
    const n = parse(raw);
    if (n === null) {
      if (finalize) {
        setDraft(String(value));
      }
      return;
    }
    const live = liveClamped(n, clamp);
    if (!finalize && live === null) {
      return;
    }
    const next = clamp ? clamp(n) : n;
    if (next !== value) {
      onCommit(next);
    }
    if (finalize) {
      setDraft(String(next));
    }
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      className={INPUT_CLASS}
      value={draft}
      aria-label={ariaLabel}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        commit(raw, false);
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        commit(event.target.value, true);
      }}
    />
  );
}

function CharsInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (chars: string) => void;
}) {
  const focusedRef = useRef(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value);
    }
  }, [value]);

  return (
    <input
      className={INPUT_CLASS}
      value={draft}
      spellCheck={false}
      aria-label="chars"
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next.length > 0 && next !== value) {
          onCommit(next);
        }
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        const next = event.target.value;
        if (next.length === 0) {
          setDraft(value);
          return;
        }
        if (next !== value) {
          onCommit(next);
        }
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-[11px] ${
        active
          ? "border-sky-500/60 bg-sky-500/15 text-sky-100"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
      }`}
    >
      {label}
    </button>
  );
}

function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function Empty({
  icon,
  label,
  hint,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-zinc-600">{icon}</div>
      <p className="text-sm font-medium text-zinc-400">{label}</p>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-600">{hint}</p>
    </div>
  );
}
