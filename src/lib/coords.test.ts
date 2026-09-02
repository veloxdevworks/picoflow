import { describe, expect, it } from "vitest";
import {
  clamp01,
  containRect,
  DEFAULT_TABLET_HEIGHT,
  DEFAULT_TABLET_WIDTH,
  insetRectangle,
  isSwipeGesture,
  pointerToImagePx,
  pointerToNormalized,
  tabletSize,
  TAP_SLOP_PX,
} from "./coords";

const rect = { left: 100, top: 50, width: 200, height: 100 };

describe("clamp01", () => {
  it("clamps outside [0, 1] and maps non-finite to 0", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("isSwipeGesture", () => {
  it("treats motion under the slop as a tap", () => {
    expect(isSwipeGesture(0, 0)).toBe(false);
    expect(isSwipeGesture(TAP_SLOP_PX - 1, 0)).toBe(false);
    expect(isSwipeGesture(TAP_SLOP_PX, 0)).toBe(true);
    expect(isSwipeGesture(3, 4)).toBe(false);
    expect(isSwipeGesture(6, 6)).toBe(true);
  });
});

describe("pointerToNormalized", () => {
  it("maps the rect center to 0.5, 0.5", () => {
    expect(pointerToNormalized(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("maps the top-left and bottom-right corners", () => {
    expect(pointerToNormalized(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToNormalized(300, 150, rect)).toEqual({ x: 1, y: 1 });
  });

  it("clamps pointers outside the image rect", () => {
    expect(pointerToNormalized(0, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToNormalized(80, 20, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToNormalized(400, 400, rect)).toEqual({ x: 1, y: 1 });
    expect(pointerToNormalized(250, -10, rect)).toEqual({ x: 0.75, y: 0 });
    expect(pointerToNormalized(50, 100, rect)).toEqual({ x: 0, y: 0.5 });
  });

  it("returns 0,0 for a zero-size rect", () => {
    expect(
      pointerToNormalized(10, 10, { left: 0, top: 0, width: 0, height: 10 }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      pointerToNormalized(10, 10, { left: 0, top: 0, width: 10, height: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("containRect", () => {
  it("letterboxes a portrait image in a landscape box", () => {
    const box = { left: 0, top: 0, width: 200, height: 100 };
    expect(containRect(box, 50, 100)).toEqual({
      left: 75,
      top: 0,
      width: 50,
      height: 100,
    });
  });

  it("pillarboxes a landscape image in a portrait box", () => {
    const box = { left: 10, top: 20, width: 100, height: 200 };
    expect(containRect(box, 100, 50)).toEqual({
      left: 10,
      top: 95,
      width: 100,
      height: 50,
    });
  });
});

describe("pointerToImagePx", () => {
  it("scales normalized coords into image pixels", () => {
    expect(pointerToImagePx(200, 100, rect, 800, 400)).toEqual({
      x: 400,
      y: 200,
    });
  });

  it("clamps outside the displayed rect to image edges", () => {
    expect(pointerToImagePx(0, 0, rect, 800, 400)).toEqual({ x: 0, y: 0 });
    expect(pointerToImagePx(1000, 1000, rect, 800, 400)).toEqual({
      x: 800,
      y: 400,
    });
  });
});

describe("tabletSize", () => {
  it("uses explicit positive pixels", () => {
    expect(tabletSize({ width: 1280, height: 800 })).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("falls back to 1920×1080 when missing or zero", () => {
    expect(tabletSize(undefined)).toEqual({
      width: DEFAULT_TABLET_WIDTH,
      height: DEFAULT_TABLET_HEIGHT,
    });
    expect(tabletSize({ width: 0, height: 0 })).toEqual({
      width: DEFAULT_TABLET_WIDTH,
      height: DEFAULT_TABLET_HEIGHT,
    });
    expect(tabletSize({ width: 2560, height: 0 })).toEqual({
      width: 2560,
      height: DEFAULT_TABLET_HEIGHT,
    });
  });
});

describe("insetRectangle", () => {
  it("matches Rust detect fallback (5% inset, inner edge width-1)", () => {
    expect(insetRectangle(100, 200)).toEqual([
      { x: 5, y: 10 },
      { x: 94, y: 10 },
      { x: 94, y: 189 },
      { x: 5, y: 189 },
    ]);
  });
});
