import { describe, expect, it } from "vitest";
import {
  actionLabel,
  convertAction,
  keyWithChars,
  keyWithKeycode,
  keyWithModifiers,
  mouseMoveAbsolute,
  mouseMoveRelative,
  swipeAction,
  tapAction,
} from "./actions";
import type { Action } from "../types/generated";

function key(partial: Partial<Extract<Action, { type: "key" }>> = {}): Extract<
  Action,
  { type: "key" }
> {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    atMs: 100,
    type: "key",
    keycode: "ENTER",
    holdMs: 50,
    ...partial,
  };
}

describe("exclusive key unions", () => {
  it("drops chars when writing a keycode", () => {
    const both = key({ keycode: "A", chars: "ok" });
    expect(keyWithKeycode(both, "TAB")).toEqual({
      id: both.id,
      atMs: 100,
      type: "key",
      keycode: "TAB",
      holdMs: 50,
    });
  });

  it("drops keycode when writing chars", () => {
    expect(keyWithChars(key(), "ok")).toEqual({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      atMs: 100,
      type: "key",
      chars: "ok",
      holdMs: 50,
    });
  });

  it("omits empty modifiers", () => {
    const withMods = key({ modifiers: ["shift"] });
    expect(keyWithModifiers(withMods, [])).not.toHaveProperty("modifiers");
    expect(keyWithModifiers(withMods, ["ctrl", "shift"]).modifiers).toEqual([
      "ctrl",
      "shift",
    ]);
  });
});

describe("exclusive mouse_move unions", () => {
  it("drops dx/dy when writing absolute", () => {
    const mixed: Extract<Action, { type: "mouse_move" }> = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      atMs: 1,
      type: "mouse_move",
      x: 0.2,
      y: 0.3,
      dx: 4,
      dy: 5,
    };
    expect(mouseMoveAbsolute(mixed, 0.5, 1.2)).toEqual({
      id: mixed.id,
      atMs: 1,
      type: "mouse_move",
      x: 0.5,
      y: 1,
    });
  });

  it("drops x/y when writing relative", () => {
    const abs: Extract<Action, { type: "mouse_move" }> = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      atMs: 1,
      type: "mouse_move",
      x: 0.2,
      y: 0.3,
    };
    expect(mouseMoveRelative(abs, -3, 8)).toEqual({
      id: abs.id,
      atMs: 1,
      type: "mouse_move",
      dx: -3,
      dy: 8,
    });
  });
});

describe("gesture factories", () => {
  it("clamps tap coords and uses the default hold", () => {
    const action = tapAction(1800, -1, 2);
    expect(action).toMatchObject({
      atMs: 1800,
      type: "tap",
      x: 0,
      y: 1,
      holdMs: 60,
    });
    expect(action.id).toHaveLength(26);
  });

  it("clamps swipe coords and enforces min duration", () => {
    expect(
      swipeAction(10, { x: -0.2, y: 0.4 }, { x: 1.4, y: 0.8 }, 1),
    ).toMatchObject({
      type: "swipe",
      x0: 0,
      y0: 0.4,
      x1: 1,
      y1: 0.8,
      durationMs: 16,
    });
  });
});

describe("convertAction", () => {
  it("keeps id/atMs and rebuilds an exclusive payload", () => {
    const tap = tapAction(200, 0.2, 0.8);
    const keycode = convertAction(tap, "key");
    expect(keycode).toMatchObject({
      id: tap.id,
      atMs: 200,
      type: "key",
      keycode: "ENTER",
      holdMs: 50,
    });
    expect(keycode).not.toHaveProperty("chars");
    expect(convertAction(tap, "mouse_move")).toMatchObject({
      type: "mouse_move",
      x: 0.2,
      y: 0.8,
    });
    expect(convertAction(keycode, "mouse_move")).toMatchObject({
      type: "mouse_move",
      x: 0.5,
      y: 0.5,
    });
  });
});

describe("actionLabel", () => {
  it("includes keycode or chars", () => {
    expect(actionLabel(key({ keycode: "ENTER" }))).toBe("Key ENTER");
    expect(actionLabel(keyWithChars(key(), "ok"))).toBe('Key "ok"');
    expect(actionLabel(tapAction(0, 0.5, 0.5))).toBe("Tap");
  });
});
