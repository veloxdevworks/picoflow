import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { type Rect } from "../../lib/coords";
import { zoomedContainRect } from "../../lib/viewport";
import { useViewportNav } from "./useViewportNav";

const EMPTY_BOX: Rect = { left: 0, top: 0, width: 0, height: 0 };

export function ViewportFrame({
  imageWidth,
  imageHeight,
  revision = 0,
  children,
}: {
  imageWidth: number;
  imageHeight: number;
  revision?: number;
  children: (ctx: {
    displayed: Rect;
    stageBox: Rect;
    stageRef: RefObject<HTMLDivElement | null>;
  }) => ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState<Rect>(EMPTY_BOX);
  const { view, spaceDown, panning, onStagePointerDown, onPanMove, endPan } =
    useViewportNav(stageRef, imageWidth, imageHeight);

  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    setStageBox({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, imageWidth, imageHeight, revision]);

  const displayed = zoomedContainRect(
    { left: 0, top: 0, width: stageBox.width, height: stageBox.height },
    imageWidth,
    imageHeight,
    view,
  );

  return (
    <div
      ref={stageRef}
      className={`relative min-h-0 flex-1 overflow-hidden ${
        spaceDown || panning ? "cursor-grab" : ""
      } ${panning ? "cursor-grabbing" : ""}`}
      onPointerDown={onStagePointerDown}
      onPointerMove={onPanMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {children({ displayed, stageBox, stageRef })}
      {spaceDown || panning ? (
        <div
          className="absolute inset-0 z-20 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onStagePointerDown}
          onPointerMove={onPanMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        />
      ) : null}
    </div>
  );
}
