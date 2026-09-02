import { useRef } from "react";
import { pointerToImagePx, type Rect } from "../../lib/coords";
import { perspectiveGridLines } from "../../lib/homography";
import type { Quad } from "../../types/commands";
import type { Point } from "../../types/generated";

const CORNER_LABELS = [
  "Top left",
  "Top right",
  "Bottom right",
  "Bottom left",
] as const;

export type HandleDrag = {
  index: number;
  point: Point;
  clientX: number;
  clientY: number;
};

function replaceCorner(corners: Quad, index: number, point: Point): Quad {
  const next: Quad = [corners[0], corners[1], corners[2], corners[3]];
  next[index] = point;
  return next;
}

function polygonPoints(corners: Quad): string {
  return corners.map((c) => `${c.x},${c.y}`).join(" ");
}

export function Handles({
  corners,
  imageWidth,
  imageHeight,
  displayed,
  onChange,
  onDrag,
}: {
  corners: Quad;
  imageWidth: number;
  imageHeight: number;
  displayed: Rect;
  onChange: (corners: Quad) => void;
  onDrag?: (drag: HandleDrag | null) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragIndex = useRef<number | null>(null);

  if (!(displayed.width > 0) || !(displayed.height > 0)) {
    return null;
  }
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    return null;
  }

  function moveCorner(index: number, clientX: number, clientY: number) {
    const el = overlayRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const point = pointerToImagePx(clientX, clientY, rect, imageWidth, imageHeight);
    onChange(replaceCorner(corners, index, point));
    onDrag?.({ index, point, clientX, clientY });
  }

  const grid = perspectiveGridLines(corners, 8);

  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute"
      style={{
        left: displayed.left,
        top: displayed.top,
        width: displayed.width,
        height: displayed.height,
      }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {grid.map((line, i) => (
          <line
            key={`g${i}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            className="stroke-sky-200/45"
            style={{ vectorEffect: "non-scaling-stroke", strokeWidth: 1 }}
          />
        ))}
        <polygon
          points={polygonPoints(corners)}
          className="fill-sky-400/10 stroke-sky-300"
          style={{ vectorEffect: "non-scaling-stroke", strokeWidth: 1.5 }}
        />
      </svg>
      {corners.map((corner, index) => (
        <button
          key={CORNER_LABELS[index]}
          type="button"
          aria-label={`${CORNER_LABELS[index]} corner`}
          className="pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full touch-none active:cursor-grabbing"
          style={{
            left: `${(corner.x / imageWidth) * 100}%`,
            top: `${(corner.y / imageHeight) * 100}%`,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragIndex.current = index;
            moveCorner(index, event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            if (dragIndex.current !== index) {
              return;
            }
            event.preventDefault();
            moveCorner(index, event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            dragIndex.current = null;
            onDrag?.(null);
          }}
          onPointerCancel={() => {
            dragIndex.current = null;
            onDrag?.(null);
          }}
        >
          <span className="block h-3 w-3 rounded-full border-2 border-zinc-950 bg-white shadow" />
        </button>
      ))}
    </div>
  );
}
