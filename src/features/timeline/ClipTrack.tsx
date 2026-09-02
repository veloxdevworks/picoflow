import type { PointerEvent } from "react";
import type { Clip, Photo } from "../../types/generated";
import { ProjectPhoto } from "../photos/ProjectPhoto";

export type RubberBand = { clipId: string; durationMs: number };

function photoById(photos: readonly Photo[], id: string): Photo | undefined {
  return photos.find((photo) => photo.id === id);
}

function photoLabel(photo: Photo | undefined, clipId: string): string {
  if (!photo) {
    return clipId;
  }
  const path = photo.warpedPath ?? photo.rawPath;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || photo.id;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Rubber-band only stretches the dragged clip; later clips stay put until pointer-up. */
function layoutClips(
  clips: readonly Clip[],
  pxPerMs: number,
  rubberBand: RubberBand | null,
  reorderIds: readonly string[] | null,
): { clip: Clip; left: number; width: number; durationMs: number }[] {
  if (reorderIds) {
    const byId = new Map(clips.map((clip) => [clip.id, clip]));
    let t = 0;
    const out: { clip: Clip; left: number; width: number; durationMs: number }[] =
      [];
    for (const id of reorderIds) {
      const clip = byId.get(id);
      if (!clip) {
        continue;
      }
      out.push({
        clip,
        left: t * pxPerMs,
        width: clip.durationMs * pxPerMs,
        durationMs: clip.durationMs,
      });
      t += clip.durationMs;
    }
    return out;
  }

  return clips.map((clip) => {
    const durationMs =
      rubberBand?.clipId === clip.id ? rubberBand.durationMs : clip.durationMs;
    return {
      clip,
      left: clip.startMs * pxPerMs,
      width: durationMs * pxPerMs,
      durationMs,
    };
  });
}

export function ClipTrack({
  clips,
  photos,
  projectDir,
  photoRev,
  pxPerMs,
  selectedId,
  rubberBand,
  reorderIds,
  draggingId,
  onSelect,
  onClipPointerDown,
  onEdgePointerDown,
  onResizeKey,
  resizeStepMs,
}: {
  clips: readonly Clip[];
  photos: readonly Photo[];
  projectDir: string | null;
  photoRev: Record<string, number>;
  pxPerMs: number;
  selectedId: string | null;
  rubberBand: RubberBand | null;
  reorderIds: readonly string[] | null;
  draggingId: string | null;
  onSelect: (clipId: string) => void;
  onClipPointerDown: (clipId: string, event: PointerEvent<HTMLElement>) => void;
  onEdgePointerDown: (clipId: string, event: PointerEvent<HTMLElement>) => void;
  onResizeKey: (clipId: string, deltaMs: number) => void;
  resizeStepMs: number;
}) {
  const laidOut = layoutClips(clips, pxPerMs, rubberBand, reorderIds);

  return (
    <div className="relative h-full bg-zinc-950">
      {laidOut.map(({ clip, left, width, durationMs }) => {
        const photo = photoById(photos, clip.photoId);
        const relative = photo?.warpedPath ?? photo?.rawPath ?? null;
        const selected = selectedId === clip.id;
        const dragging = draggingId === clip.id;
        const label = `${photoLabel(photo, clip.id)}, ${formatDuration(durationMs)}`;
        return (
          <div
            key={clip.id}
            role="group"
            tabIndex={0}
            aria-label={label}
            aria-current={selected ? "true" : undefined}
            className={`absolute inset-y-1 overflow-hidden rounded-sm border text-left touch-none ${
              selected
                ? "border-sky-400 z-10"
                : "border-zinc-700 hover:border-zinc-500"
            } ${dragging ? "opacity-80" : ""}`}
            style={{ left, width: Math.max(width, 4), cursor: "grab" }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0) {
                return;
              }
              onSelect(clip.id);
              onClipPointerDown(clip.id, event);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(clip.id);
                return;
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                onResizeKey(
                  clip.id,
                  event.key === "ArrowRight" ? resizeStepMs : -resizeStepMs,
                );
              }
            }}
          >
            <div className="absolute inset-0 bg-zinc-800">
              {projectDir && relative ? (
                <ProjectPhoto
                  projectDir={projectDir}
                  relativePath={relative}
                  alt=""
                  className="pointer-events-none h-full w-full object-cover opacity-80"
                  cacheKey={String(photoRev[clip.photoId] ?? 0)}
                />
              ) : null}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-zinc-950/70 px-1 py-0.5 text-[10px] text-zinc-200">
              {formatDuration(durationMs)}
            </div>
            <button
              type="button"
              aria-label={`Resize ${label}`}
              className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize touch-none hover:bg-sky-400/40"
              onPointerDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                if (event.button !== 0) {
                  return;
                }
                onSelect(clip.id);
                onEdgePointerDown(clip.id, event);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                  onResizeKey(
                    clip.id,
                    event.key === "ArrowRight" ? resizeStepMs : -resizeStepMs,
                  );
                }
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
