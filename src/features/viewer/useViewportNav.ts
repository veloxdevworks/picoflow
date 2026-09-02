import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { containRect, type Rect } from "../../lib/coords";
import { isEditableTarget } from "../../lib/keys";
import {
  clampViewZoom,
  IDENTITY_VIEW,
  panBy,
  zoomAtPoint,
  type ViewportTransform,
} from "../../lib/viewport";

const ZOOM_FACTOR = 1.12;

export function useViewportNav(
  stageRef: RefObject<HTMLElement | null>,
  imageWidth: number,
  imageHeight: number,
) {
  const [view, setView] = useState<ViewportTransform>(IDENTITY_VIEW);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    setView(IDENTITY_VIEW);
  }, [imageWidth, imageHeight]);

  const baseRect = useCallback((): Rect => {
    const el = stageRef.current;
    if (!el) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const r = el.getBoundingClientRect();
    return containRect(
      { left: 0, top: 0, width: r.width, height: r.height },
      imageWidth,
      imageHeight,
    );
  }, [imageHeight, imageWidth, stageRef]);

  const localPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = stageRef.current;
      if (!el) {
        return { x: 0, y: 0 };
      }
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    },
    [stageRef],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setSpaceDown(true);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space") {
        return;
      }
      setSpaceDown(false);
    }
    function onBlur() {
      setSpaceDown(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const local = localPoint(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      setView((current) => {
        const nextZoom = clampViewZoom(current.zoom * factor);
        if (nextZoom === current.zoom) {
          return current;
        }
        return zoomAtPoint(baseRect(), current, nextZoom, local.x, local.y);
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [baseRect, localPoint, stageRef]);

  const beginPan = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanning(true);
    },
    [],
  );

  const onPanMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!panning) {
        return;
      }
      event.preventDefault();
      setView((current) => panBy(baseRect(), current, event.movementX, event.movementY));
    },
    [baseRect, panning],
  );

  const endPan = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
  }, []);

  const onStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button === 1 || (event.button === 0 && spaceDown)) {
        beginPan(event);
      }
    },
    [beginPan, spaceDown],
  );

  return {
    view,
    spaceDown,
    panning,
    onStagePointerDown,
    onPanMove,
    endPan,
  };
}
