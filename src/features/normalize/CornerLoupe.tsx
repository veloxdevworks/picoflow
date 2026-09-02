import type { Point } from "../../types/generated";
import type { Rect } from "../../lib/coords";
import { ProjectPhoto } from "../photos/ProjectPhoto";

const SIZE = 160;
const MAG = 4;

export function CornerLoupe({
  projectDir,
  relativePath,
  cacheKey,
  imageWidth,
  imageHeight,
  point,
  clientX,
  clientY,
  stage,
}: {
  projectDir: string;
  relativePath: string;
  cacheKey?: string;
  imageWidth: number;
  imageHeight: number;
  point: Point;
  clientX: number;
  clientY: number;
  stage: Rect;
}) {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(stage.width > 0)) {
    return null;
  }
  const pointerLeft = clientX < stage.left + stage.width / 2;
  const pointerTop = clientY < stage.top + stage.height / 2;
  const scale = (SIZE * MAG) / imageWidth;
  const imgW = imageWidth * scale;
  const imgH = imageHeight * scale;

  return (
    <div
      className="pointer-events-none absolute z-30 overflow-hidden rounded-full border-2 border-sky-300/70 bg-zinc-950 shadow-xl shadow-black/50"
      style={{
        width: SIZE,
        height: SIZE,
        left: pointerLeft ? undefined : 12,
        right: pointerLeft ? 12 : undefined,
        top: pointerTop ? undefined : 12,
        bottom: pointerTop ? 12 : undefined,
      }}
      aria-hidden
    >
      <ProjectPhoto
        projectDir={projectDir}
        relativePath={relativePath}
        alt=""
        cacheKey={cacheKey}
        className="absolute max-w-none"
        style={{
          width: imgW,
          height: imgH,
          left: -(point.x * scale - SIZE / 2),
          top: -(point.y * scale - SIZE / 2),
        }}
      />
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-sky-200/80" />
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-200/80" />
    </div>
  );
}
