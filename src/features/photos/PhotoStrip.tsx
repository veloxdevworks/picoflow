import { useCallback, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Image as ImageIcon, ImagePlus, Images } from "lucide-react";
import { useEditor } from "../../store/editor";
import {
  errorMessage,
  IMPORT_PROGRESS_EVENT,
  importPhotos,
  isCanceled,
  pickImportPhotos,
  type ImportProgress,
} from "../../types/commands";
import type { Photo } from "../../types/generated";
import { ProjectPhoto } from "./ProjectPhoto";

function photoLabel(photo: Photo): string {
  const path = photo.warpedPath ?? photo.rawPath;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || photo.id;
}

function progressLabel(progress: ImportProgress): string {
  const verb = progress.phase === "converting" ? "Converting…" : "Importing…";
  return `${verb} ${progress.current}/${progress.total} · ${progress.filename}`;
}

export function PhotoStrip() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const setProject = useEditor((s) => s.setProject);
  const setNormalize = useEditor((s) => s.setNormalize);
  const photoRev = useEditor((s) => s.photoRev);
  const photos = project?.photos ?? [];
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

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
    setProgress(null);
    void (async () => {
      const failed: string[] = [];
      let selectedFirst = false;
      let unlisten: (() => void) | undefined;
      try {
        const paths = await pickImportPhotos();
        unlisten = await listen<ImportProgress>(
          IMPORT_PROGRESS_EVENT,
          (event) => {
            const payload = event.payload;
            setProgress(payload);
            if (payload.error) {
              failed.push(payload.filename || payload.error);
            }
            const incoming = payload.photo;
            if (!incoming) {
              return;
            }
            const latest = useEditor.getState().project ?? current;
            if (latest.photos.some((photo) => photo.id === incoming.id)) {
              return;
            }
            setProject({ ...latest, photos: [...latest.photos, incoming] });
            if (!selectedFirst) {
              selectedFirst = true;
              setNormalize(null);
              setSelection({ type: "photo", id: incoming.id });
            }
          },
        );
        const imported = await importPhotos(paths);
        const latest = useEditor.getState().project ?? current;
        const have = new Set(latest.photos.map((photo) => photo.id));
        const missing = imported.filter((photo) => !have.has(photo.id));
        if (missing.length > 0) {
          setProject({ ...latest, photos: [...latest.photos, ...missing] });
          if (!selectedFirst) {
            setNormalize(null);
            setSelection({ type: "photo", id: missing[0].id });
          }
        }
        if (failed.length > 0) {
          setError(`Failed: ${failed.join(", ")}`);
        }
      } catch (err) {
        if (!isCanceled(err)) {
          setError(errorMessage(err));
        }
      } finally {
        unlisten?.();
        busyRef.current = false;
        setBusy(false);
        setProgress(null);
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
      {progress ? (
        <div className="border-b border-zinc-800 px-2 py-1.5" aria-live="polite">
          <p className="truncate text-[11px] text-zinc-400" title={progressLabel(progress)}>
            {progressLabel(progress)}
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full rounded bg-sky-600 transition-[width]"
              style={{
                width: `${
                  progress.total > 0
                    ? Math.min(100, (progress.current / progress.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="truncate px-2 py-1 text-[11px] text-red-400" title={error}>
          {error}
        </p>
      ) : null}
      {photos.length === 0 && !progress ? (
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
                  onClick={() => {
                    if (useEditor.getState().playing) {
                      useEditor.getState().pause();
                    }
                    setSelection({ type: "photo", id: photo.id });
                  }}
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
                        cacheKey={String(photoRev[photo.id] ?? 0)}
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
