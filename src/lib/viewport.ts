import { containRect, type Rect } from "./coords";

export const VIEW_MIN_ZOOM = 1;
export const VIEW_MAX_ZOOM = 8;

export type ViewportTransform = {
  zoom: number;
  panX: number;
  panY: number;
};

export const IDENTITY_VIEW: ViewportTransform = { zoom: 1, panX: 0, panY: 0 };

export function clampViewZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return VIEW_MIN_ZOOM;
  }
  return Math.min(VIEW_MAX_ZOOM, Math.max(VIEW_MIN_ZOOM, zoom));
}

function clampNum(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(max, Math.max(min, n));
}

/** `object-fit: contain` rect, then zoom/pan in the same local box space. */
export function zoomedContainRect(
  box: Rect,
  imageWidth: number,
  imageHeight: number,
  transform: ViewportTransform,
): Rect {
  return applyViewport(containRect(box, imageWidth, imageHeight), transform);
}

export function applyViewport(base: Rect, transform: ViewportTransform): Rect {
  const zoom = clampViewZoom(transform.zoom);
  return {
    left: base.left + transform.panX,
    top: base.top + transform.panY,
    width: base.width * zoom,
    height: base.height * zoom,
  };
}

/**
 * Keep the zoomed image overlapping the contain box. At 1×, pan is zero
 * (no letterbox drag). Pan is non-positive because zoom grows down/right
 * from the contain origin unless zoomAtPoint shifts it.
 */
export function clampViewPan(
  base: Rect,
  zoom: number,
  panX: number,
  panY: number,
): { panX: number; panY: number } {
  const z = clampViewZoom(zoom);
  if (z <= 1 || !(base.width > 0) || !(base.height > 0)) {
    return { panX: 0, panY: 0 };
  }
  const overflowX = base.width * (z - 1);
  const overflowY = base.height * (z - 1);
  return {
    panX: clampNum(panX, -overflowX, overflowX),
    panY: clampNum(panY, -overflowY, overflowY),
  };
}

/** Zoom so `(cx, cy)` in local box space stays under the cursor. */
export function zoomAtPoint(
  base: Rect,
  current: ViewportTransform,
  nextZoom: number,
  cx: number,
  cy: number,
): ViewportTransform {
  const zoom = clampViewZoom(nextZoom);
  const prev = applyViewport(base, current);
  const nx = prev.width > 0 ? (cx - prev.left) / prev.width : 0.5;
  const ny = prev.height > 0 ? (cy - prev.top) / prev.height : 0.5;
  const panX = cx - nx * base.width * zoom - base.left;
  const panY = cy - ny * base.height * zoom - base.top;
  const pan = clampViewPan(base, zoom, panX, panY);
  return { zoom, ...pan };
}

export function panBy(
  base: Rect,
  current: ViewportTransform,
  dx: number,
  dy: number,
): ViewportTransform {
  const zoom = clampViewZoom(current.zoom);
  const pan = clampViewPan(base, zoom, current.panX + dx, current.panY + dy);
  return { zoom, ...pan };
}
