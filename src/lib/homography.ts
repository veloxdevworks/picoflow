import type { Point } from "../types/generated";
import type { Quad } from "../types/commands";

/** Row-major 3×3 homography. Maps `(x, y, 1)` → `(x′, y′, w)`. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type GridLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Apply `H` to a point. Degenerate `w` yields `{x:0,y:0}`. */
export function applyHomography(h: Homography, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) {
    return { x: 0, y: 0 };
  }
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

/**
 * DLT homography from four source points onto four dest points (TL, TR, BR, BL).
 * Same 8-equation layout as `picoflow_image::warp::homography`.
 */
export function homography(src: Quad, dst: Quad): Homography | null {
  const a: number[][] = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
  const b = Array<number>(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: xp, y: yp } = dst[i];
    const r = i * 2;
    a[r][0] = x;
    a[r][1] = y;
    a[r][2] = 1;
    a[r][6] = -x * xp;
    a[r][7] = -y * xp;
    b[r] = xp;
    a[r + 1][3] = x;
    a[r + 1][4] = y;
    a[r + 1][5] = 1;
    a[r + 1][6] = -x * yp;
    a[r + 1][7] = -y * yp;
    b[r + 1] = yp;
  }
  const h = solve8(a, b);
  if (!h) {
    return null;
  }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Unit square (0,0)–(1,1) → screen quad (TL, TR, BR, BL). */
export function quadFromUnitSquare(corners: Quad): Homography | null {
  return homography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    corners,
  );
}

/**
 * Perspective grid lines in dest (image) space. Homography-warped, so a bad
 * quad will not line up with an axis-aligned tablet UI.
 */
export function perspectiveGridLines(corners: Quad, divisions = 8): GridLine[] {
  if (divisions < 1) {
    return [];
  }
  const h = quadFromUnitSquare(corners);
  if (!h) {
    return [];
  }
  const lines: GridLine[] = [];
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    const left = applyHomography(h, 0, t);
    const right = applyHomography(h, 1, t);
    lines.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y });
    const top = applyHomography(h, t, 0);
    const bottom = applyHomography(h, t, 1);
    lines.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y });
  }
  return lines;
}

/** Gaussian elimination with partial pivot for an 8×8 system. */
function solve8(aIn: number[][], bIn: number[]): number[] | null {
  const n = 8;
  const m = aIn.map((row, i) => [...row, bIn[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let row = col + 1; row < n; row++) {
      const mag = Math.abs(m[row][col]);
      if (mag > best) {
        best = mag;
        pivot = row;
      }
    }
    if (best < 1e-12) {
      return null;
    }
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const diag = m[col][col];
    for (let j = col; j <= n; j++) {
      m[col][j] /= diag;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) {
        continue;
      }
      const f = m[row][col];
      if (f === 0) {
        continue;
      }
      for (let j = col; j <= n; j++) {
        m[row][j] -= f * m[col][j];
      }
    }
  }
  const x = m.map((row) => row[n]);
  if (x.some((v) => !Number.isFinite(v))) {
    return null;
  }
  return x;
}
