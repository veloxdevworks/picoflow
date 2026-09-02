import { describe, expect, it } from "vitest";
import { containRect } from "./coords";
import {
  applyViewport,
  clampViewPan,
  clampViewZoom,
  VIEW_MAX_ZOOM,
  VIEW_MIN_ZOOM,
  zoomAtPoint,
  zoomedContainRect,
} from "./viewport";

const box = { left: 0, top: 0, width: 200, height: 100 };

describe("clampViewZoom", () => {
  it("stays inside 1…8", () => {
    expect(clampViewZoom(0.5)).toBe(VIEW_MIN_ZOOM);
    expect(clampViewZoom(1)).toBe(1);
    expect(clampViewZoom(4)).toBe(4);
    expect(clampViewZoom(32)).toBe(VIEW_MAX_ZOOM);
    expect(clampViewZoom(Number.NaN)).toBe(VIEW_MIN_ZOOM);
  });
});

describe("zoomedContainRect", () => {
  it("matches contain at 1× and scales from the contain origin", () => {
    const base = containRect(box, 50, 100);
    expect(zoomedContainRect(box, 50, 100, { zoom: 1, panX: 0, panY: 0 })).toEqual(
      base,
    );
    expect(zoomedContainRect(box, 50, 100, { zoom: 2, panX: 0, panY: 0 })).toEqual({
      left: base.left,
      top: base.top,
      width: base.width * 2,
      height: base.height * 2,
    });
  });
});

describe("zoomAtPoint", () => {
  it("keeps the cursor’s image point fixed", () => {
    const base = containRect(box, 100, 50);
    const start = { zoom: 1, panX: 0, panY: 0 };
    const before = applyViewport(base, start);
    const cx = before.left + before.width * 0.25;
    const cy = before.top + before.height * 0.5;
    const next = zoomAtPoint(base, start, 2, cx, cy);
    const after = applyViewport(base, next);
    expect((cx - after.left) / after.width).toBeCloseTo(0.25, 6);
    expect((cy - after.top) / after.height).toBeCloseTo(0.5, 6);
  });
});

describe("clampViewPan", () => {
  it("zeros pan at 1×", () => {
    expect(clampViewPan(box, 1, 40, -10)).toEqual({ panX: 0, panY: 0 });
  });
});
