import type { ReactNode } from "react";
import { Monitor } from "lucide-react";
import { clipAt } from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import { ProjectPhoto } from "../photos/ProjectPhoto";

export function WarpedViewer() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const playheadMs = useEditor((s) => s.playheadMs);
  const photoRev = useEditor((s) => s.photoRev);

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

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="relative min-h-0 flex-1">
        <ProjectPhoto
          projectDir={projectDir}
          relativePath={relative}
          alt="Clip under playhead"
          className="h-full w-full object-contain"
          cacheKey={String(photoRev[photo.id] ?? 0)}
        />
      </div>
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
