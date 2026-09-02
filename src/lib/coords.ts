import type { Point } from "../types/generated";

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const DETECT_CONFIDENCE_THRESHOLD = 0.55;
/** Pixel slop before a pointer-down becomes a swipe instead of a tap. */
export const TAP_SLOP_PX = 8;

/** Matches Rust `DEFAULT_TARGET_WIDTH` / `DEFAULT_TARGET_HEIGHT`. */
export const DEFAULT_TABLET_WIDTH = 1920;
export const DEFAULT_TABLET_HEIGHT = 1080;

export type TabletSize = { width: number; height: number };

export const TABLET_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "1920 × 1200", width: 1920, height: 1200 },
  { label: "2560 × 1600", width: 2560, height: 1600 },
  { label: "1280 × 800", width: 1280, height: 800 },
  { label: "1080 × 1920", width: 1080, height: 1920 },
];

/** Positive tablet pixels; omitted or 0 falls back to 1920×1080. */
export function tabletSize(target: { width?: number; height?: number } | null | undefined): TabletSize {
  const width = target?.width && target.width > 0 ? target.width : DEFAULT_TABLET_WIDTH;
  const height = target?.height && target.height > 0 ? target.height : DEFAULT_TABLET_HEIGHT;
  return { width, height };
}

export function isSwipeGesture(dx: number, dy: number, slopPx = TAP_SLOP_PX): boolean {
  return dx * dx + dy * dy >= slopPx * slopPx;
}

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
