import type { Point } from "../types/generated";

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const DETECT_CONFIDENCE_THRESHOLD = 0.55;

export function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  if (n >= 1) {
    return 1;
  }
  return n;
}

/** Map a pointer in client space onto a rect, clamped to [0, 1]. */
export function pointerToNormalized(
  clientX: number,
  clientY: number,
  rect: Rect,
): Point {
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return { x: 0, y: 0 };
  }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** `object-fit: contain` destination of an image inside `box` (client space). */
export function containRect(
  box: Rect,
  imageWidth: number,
  imageHeight: number,
): Rect {
  if (
    !(imageWidth > 0) ||
    !(imageHeight > 0) ||
    !(box.width > 0) ||
    !(box.height > 0)
  ) {
    return { left: box.left, top: box.top, width: 0, height: 0 };
  }
  const boxAspect = box.width / box.height;
  const imageAspect = imageWidth / imageHeight;
  if (boxAspect > imageAspect) {
    const width = box.height * imageAspect;
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top,
      width,
      height: box.height,
    };
  }
  const height = box.width / imageAspect;
  return {
    left: box.left,
    top: box.top + (box.height - height) / 2,
    width: box.width,
    height,
  };
}

/** Pointer in client space → oriented-image pixels, clamped to the image. */
export function pointerToImagePx(
  clientX: number,
  clientY: number,
  displayed: Rect,
  imageWidth: number,
  imageHeight: number,
): Point {
  const n = pointerToNormalized(clientX, clientY, displayed);
  return {
    x: n.x * imageWidth,
    y: n.y * imageHeight,
  };
}

/** 5% inset rectangle used when detect returns no quad. Order: TL, TR, BR, BL. */
export function insetRectangle(
  width: number,
  height: number,
  frac = 0.05,
): [Point, Point, Point, Point] {
  const mx = Math.min(width * frac, width / 2);
  const my = Math.min(height * frac, height / 2);
  const x1 = Math.max(width - 1 - mx, mx);
  const y1 = Math.max(height - 1 - my, my);
  return [
    { x: mx, y: my },
    { x: x1, y: my },
    { x: x1, y: y1 },
    { x: mx, y: y1 },
  ];
}
