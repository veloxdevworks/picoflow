import { useRef, type PointerEvent as ReactPointerEvent } from "react";

export function Splitter({
  orientation,
  edge = "end",
  label,
  onDrag,
}: {
  orientation: "vertical" | "horizontal";
  edge?: "start" | "end";
  label: string;
  onDrag: (delta: number) => void;
}) {
  const last = useRef<number | null>(null);
  const vertical = orientation === "vertical";

  function pos(event: ReactPointerEvent<HTMLButtonElement>): number {
    return vertical ? event.clientX : event.clientY;
  }

  const placement = vertical
    ? edge === "start"
      ? "absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize"
      : "absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize"
    : "absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize";

  return (
    <button
      type="button"
      aria-label={label}
      className={`${placement} touch-none select-none bg-transparent hover:bg-sky-400/30`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        last.current = pos(event);
      }}
      onPointerMove={(event) => {
        if (last.current === null) {
          return;
        }
        const next = pos(event);
        onDrag(next - last.current);
        last.current = next;
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
    />
  );
}
