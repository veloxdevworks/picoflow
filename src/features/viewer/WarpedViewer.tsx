import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Monitor } from "lucide-react";
import { actionLabel } from "../../lib/actions";
import { containRect, tabletSize, type Rect } from "../../lib/coords";
import { clipAt, upcomingKeyframe } from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import { ProjectPhoto } from "../photos/ProjectPhoto";
import { TapSwipeLayer } from "./TapSwipeLayer";

const EMPTY_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

export function WarpedViewer() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const playheadMs = useEditor((s) => s.playheadMs);
  const photoRev = useEditor((s) => s.photoRev);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState<Rect>(EMPTY_RECT);

  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    setStageBox({ left: 0, top: 0, width: r.width, height: r.height });
  }, []);

  const tablet = tabletSize(project?.target);
  useLayoutEffect(() => {
    measure();
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tablet.width, tablet.height]);

  if (!project) {
    return (
      <Empty
        icon={<Monitor className="h-6 w-6" aria-hidden />}
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

  if (!clip || !photo || !projectDir || !relative) {
    return (
      <Empty
        icon={<Monitor className="h-6 w-6" aria-hidden />}
        label="No warped frame"
        hint="Scrub the playhead after a photo is confirmed onto the clip track."
      />
    );
  }

  const frame = containRect(stageBox, tablet.width, tablet.height);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-zinc-950">
      <div ref={stageRef} className="relative min-h-0 flex-1">
        {frame.width > 0 && frame.height > 0 ? (
          <div
            className="absolute overflow-hidden bg-zinc-950"
            style={{
              left: frame.left,
              top: frame.top,
              width: frame.width,
              height: frame.height,
            }}
          >
            <ProjectPhoto
              projectDir={projectDir}
              relativePath={relative}
              alt="Clip under playhead"
              className="h-full w-full object-contain"
              cacheKey={String(photoRev[photo.id] ?? 0)}
            />
            <TapSwipeLayer imageWidth={tablet.width} imageHeight={tablet.height} />
          </div>
        ) : null}
      </div>
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

function Empty({
  icon,
  label,
  hint,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-zinc-600">{icon}</div>
      <p className="text-sm font-medium text-zinc-400">{label}</p>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-600">{hint}</p>
    </div>
  );
}
