import { describe, expect, it } from "vitest";
import {
  applyHomography,
  perspectiveGridLines,
  quadFromUnitSquare,
} from "./homography";
import type { Quad } from "../types/commands";

const unit: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const rect: Quad = [
  { x: 10, y: 20 },
  { x: 110, y: 20 },
  { x: 110, y: 70 },
  { x: 10, y: 70 },
];

describe("quadFromUnitSquare", () => {
  it("maps unit-square corners onto a rectangle", () => {
    const h = quadFromUnitSquare(rect);
    expect(h).not.toBeNull();
    if (!h) {
      return;
    }
    expect(applyHomography(h, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(applyHomography(h, 1, 0)).toEqual({ x: 110, y: 20 });
    expect(applyHomography(h, 1, 1)).toEqual({ x: 110, y: 70 });
    expect(applyHomography(h, 0, 1)).toEqual({ x: 10, y: 70 });
    expect(applyHomography(h, 0.5, 0.5)).toEqual({ x: 60, y: 45 });
  });

  it("is identity on the unit square", () => {
    const h = quadFromUnitSquare(unit);
    expect(h).not.toBeNull();
    if (!h) {
      return;
    }
    expect(applyHomography(h, 0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 });
  });
});

describe("perspectiveGridLines", () => {
  it("emits 2 × (divisions+1) lines through the warped plane", () => {
    const lines = perspectiveGridLines(rect, 8);
    expect(lines).toHaveLength(18);
    const midH = lines.find(
      (line) =>
        Math.abs(line.y1 - 45) < 1e-6 &&
        Math.abs(line.y2 - 45) < 1e-6 &&
        Math.abs(line.x1 - 10) < 1e-6,
    );
    const midV = lines.find(
      (line) =>
        Math.abs(line.x1 - 60) < 1e-6 &&
        Math.abs(line.x2 - 60) < 1e-6 &&
        Math.abs(line.y1 - 20) < 1e-6,
    );
    expect(midH).toBeDefined();
    expect(midV).toBeDefined();
  });

  it("places the midline toward the short edge of a trapezoid", () => {
    const trap: Quad = [
      { x: 20, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const h = quadFromUnitSquare(trap);
    expect(h).not.toBeNull();
    if (!h) {
      return;
    }
    const mid = applyHomography(h, 0.5, 0.5);
    // Euclidean average of the top/bottom would sit at y=50. Perspective
    // pulls the unit-square midline toward the short top edge.
    expect(mid.y).toBeLessThan(50);
    expect(mid.x).toBeCloseTo(50, 5);
  });

  it("returns no lines for a degenerate quad", () => {
    const collapsed: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(perspectiveGridLines(collapsed, 8)).toEqual([]);
  });
});
