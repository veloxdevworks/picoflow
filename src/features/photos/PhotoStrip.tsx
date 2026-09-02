import { useCallback, useRef, useState } from "react";
import { Image as ImageIcon, ImagePlus, Images } from "lucide-react";
import { useEditor } from "../../store/editor";
import {
  errorMessage,
  importPhotos,
  isCanceled,
  pickImportPhotos,
} from "../../types/commands";
import type { Photo } from "../../types/generated";
import { ProjectPhoto } from "./ProjectPhoto";

function photoLabel(photo: Photo): string {
  const path = photo.warpedPath ?? photo.rawPath;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || photo.id;
}

export function PhotoStrip() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const setProject = useEditor((s) => s.setProject);
  const setNormalize = useEditor((s) => s.setNormalize);
  const photos = project?.photos ?? [];
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImport = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    const current = useEditor.getState().project;
    if (!current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const paths = await pickImportPhotos();
        const imported = await importPhotos(paths);
        if (imported.length === 0) {
          return;
        }
        const latest = useEditor.getState().project ?? current;
        setProject({ ...latest, photos: [...latest.photos, ...imported] });
        setNormalize(null);
        setSelection({ type: "photo", id: imported[0].id });
      } catch (err) {
        if (!isCanceled(err)) {
          setError(errorMessage(err));
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [setNormalize, setProject, setSelection]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-2 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Photos
        </span>
        <button
          type="button"
          disabled={!project || busy}
          onClick={onImport}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
          Import
        </button>
      </div>
      {error ? (
        <p className="truncate px-2 py-1 text-[11px] text-red-400" title={error}>
          {error}
        </p>
      ) : null}
      {photos.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
          <Images className="h-5 w-5 text-zinc-600" aria-hidden />
          <p className="text-xs font-medium text-zinc-500">No photos</p>
          <p className="text-[11px] leading-snug text-zinc-600">
            {project
              ? "Import JPEG, PNG, or HEIC (macOS) to start."
              : "Walkthrough photos will appear here."}
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {photos.map((photo) => {
            const selected =
              selection?.type === "photo" && selection.id === photo.id;
            const relative = photo.warpedPath ?? photo.rawPath;
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
                  <div className="relative flex aspect-[4/3] items-center justify-center bg-zinc-950">
                    {projectDir ? (
                      <ProjectPhoto
                        projectDir={projectDir}
                        relativePath={relative}
                        alt={photoLabel(photo)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-zinc-600" aria-hidden />
                    )}
                    {!photo.normalized ? (
                      <span
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400"
                        title="Needs normalize"
                      />
                    ) : null}
                  </div>
                  <span className="truncate px-2 py-1 text-[11px] text-zinc-400">
                    {photoLabel(photo)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
