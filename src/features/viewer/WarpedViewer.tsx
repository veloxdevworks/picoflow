import { Monitor } from "lucide-react";
import { actionLabel } from "../../lib/actions";
import { tabletSize } from "../../lib/coords";
import { clipAt, upcomingKeyframe } from "../../lib/timeline";
import { EmptyState } from "../../layout/EmptyState";
import { useEditor } from "../../store/editor";
import { ProjectPhoto } from "../photos/ProjectPhoto";
import { TapSwipeLayer } from "./TapSwipeLayer";
import { ViewportFrame } from "./ViewportFrame";

export function WarpedViewer() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const playheadMs = useEditor((s) => s.playheadMs);
  const photoRev = useEditor((s) => s.photoRev);

  if (!project) {
    return (
      <EmptyState
        icon={<Monitor className="h-10 w-10" aria-hidden />}
        label="No project open"
        hint="File → New or Open to create a .picoflow project."
      />
    );
  }

  const clip = clipAt(project.clips, playheadMs);
  const upcoming = upcomingKeyframe(project.actions, playheadMs);
  const photo = clip
    ? project.photos.find((item) => item.id === clip.photoId)
    : undefined;
  const relative = photo?.warpedPath ?? photo?.rawPath ?? null;
  const tablet = tabletSize(project.target);

  if (!clip || !photo || !projectDir || !relative) {
    return (
      <EmptyState
        icon={<Monitor className="h-10 w-10" aria-hidden />}
        label="No warped frame"
        hint="Scrub the playhead after a photo is confirmed onto the clip track."
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-zinc-950">
      <ViewportFrame imageWidth={tablet.width} imageHeight={tablet.height}>
        {({ displayed }) => (
          <>
            <ProjectPhoto
              projectDir={projectDir}
              relativePath={relative}
              alt="Clip under playhead"
              className="absolute object-fill"
              style={{
                left: displayed.left,
                top: displayed.top,
                width: displayed.width,
                height: displayed.height,
              }}
              cacheKey={String(photoRev[photo.id] ?? 0)}
            />
            <TapSwipeLayer
              imageWidth={tablet.width}
              imageHeight={tablet.height}
              displayed={displayed}
            />
          </>
        )}
      </ViewportFrame>
      <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-zinc-400">
        {upcoming
          ? `Next: ${actionLabel(upcoming)} · ${upcoming.atMs} ms`
          : "No upcoming action"}
        <span className="mt-0.5 block text-zinc-600">
          Click to tap · drag to swipe · not live HID
        </span>
      </p>
    </div>
  );
}
