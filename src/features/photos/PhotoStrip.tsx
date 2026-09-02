import { Image as ImageIcon, Images } from "lucide-react";
import { photoUrl } from "../../lib/photoUrl";
import { useEditor } from "../../store/editor";
import type { Photo } from "../../types/generated";

function photoLabel(photo: Photo): string {
  const path = photo.warpedPath ?? photo.rawPath;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || photo.id;
}

function thumbSrc(
  projectDir: string | null,
  photo: Photo,
): string | undefined {
  if (!projectDir) {
    return undefined;
  }
  const relative = photo.warpedPath ?? photo.rawPath;
  return photoUrl(projectDir, relative);
}

export function PhotoStrip() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const photos = project?.photos ?? [];

  if (photos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
        <Images className="h-5 w-5 text-zinc-600" aria-hidden />
        <p className="text-xs font-medium text-zinc-500">No photos</p>
        <p className="text-[11px] leading-snug text-zinc-600">
          Walkthrough photos will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      {photos.map((photo) => {
        const selected = selection?.type === "photo" && selection.id === photo.id;
        const src = thumbSrc(projectDir, photo);
        return (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setSelection({ type: "photo", id: photo.id })}
              className={`flex w-full flex-col overflow-hidden rounded-md border text-left transition ${
                selected
                  ? "border-zinc-400 bg-zinc-800"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
              }`}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-zinc-950">
                {src ? (
                  <img
                    src={src}
                    alt={photoLabel(photo)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-5 w-5 text-zinc-600" aria-hidden />
                )}
              </div>
              <span className="truncate px-2 py-1 text-[11px] text-zinc-400">
                {photoLabel(photo)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
