import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Crop, Monitor, RefreshCw } from "lucide-react";
import {
  containRect,
  DETECT_CONFIDENCE_THRESHOLD,
  insetRectangle,
  type Rect,
} from "../../lib/coords";
import { newId } from "../../lib/ids";
import { DEFAULT_CLIP_DURATION_MS } from "../../lib/timeline";
import { useEditor } from "../../store/editor";
import {
  detectScreenQuad,
  errorMessage,
  warpPhoto,
  type Quad,
} from "../../types/commands";
import type { Clip, Photo } from "../../types/generated";
import { ProjectPhoto } from "../photos/ProjectPhoto";
import { Handles } from "./Handles";

const EMPTY_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

function photoById(photos: Photo[], id: string): Photo | undefined {
  return photos.find((photo) => photo.id === id);
}

async function detectIntoSession(
  photo: Photo,
  preferExisting: boolean,
): Promise<void> {
  const { setNormalize } = useEditor.getState();
  if (preferExisting && photo.corners) {
    setNormalize({
      photoId: photo.id,
      corners: photo.corners,
      confidence: 1,
      imageWidth: photo.width,
      imageHeight: photo.height,
    });
    return;
  }
  try {
    const result = await detectScreenQuad(photo.id);
    if (!stillSelected(photo.id)) {
      return;
    }
    setNormalize({
      photoId: photo.id,
      corners: result.corners,
      confidence: result.confidence,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
    });
  } catch {
    if (!stillSelected(photo.id)) {
      return;
    }
    setNormalize({
      photoId: photo.id,
      corners: insetRectangle(photo.width, photo.height),
      confidence: 0,
      imageWidth: photo.width,
      imageHeight: photo.height,
    });
  }
}

function stillSelected(photoId: string): boolean {
  const selection = useEditor.getState().selection;
  return selection?.type === "photo" && selection.id === photoId;
}

function appendClipIfNeeded(clips: Clip[], warped: Photo): Clip[] {
  if (clips.some((clip) => clip.photoId === warped.id)) {
    return clips;
  }
  const last = clips[clips.length - 1];
  const startMs = last ? last.startMs + last.durationMs : 0;
  return [
    ...clips,
    {
      id: newId(),
      photoId: warped.id,
      startMs,
      durationMs: DEFAULT_CLIP_DURATION_MS,
    },
  ];
}

export function NormalizeView() {
  const project = useEditor((s) => s.project);
  const projectDir = useEditor((s) => s.projectDir);
  const selection = useEditor((s) => s.selection);
  const normalize = useEditor((s) => s.normalize);
  const setProject = useEditor((s) => s.setProject);
  const setSelection = useEditor((s) => s.setSelection);
  const setNormalize = useEditor((s) => s.setNormalize);
  const setNormalizeCorners = useEditor((s) => s.setNormalizeCorners);

  const selectedPhoto =
    project && selection?.type === "photo"
      ? photoById(project.photos, selection.id)
      : undefined;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceEdit, setForceEdit] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState<Rect>(EMPTY_RECT);

  const editing =
    !!selectedPhoto &&
    (!selectedPhoto.normalized || forceEdit || normalize?.photoId === selectedPhoto.id);

  useEffect(() => {
    setForceEdit(false);
    setError(null);
  }, [selectedPhoto?.id]);

  useEffect(() => {
    if (!selectedPhoto || !editing) {
      if (normalize && selectedPhoto && normalize.photoId !== selectedPhoto.id) {
        setNormalize(null);
      }
      setBusy(false);
      return;
    }
    if (normalize?.photoId === selectedPhoto.id) {
      return;
    }
    const photo = selectedPhoto;
    let cancelled = false;
    setBusy(true);
    void detectIntoSession(photo, forceEdit && !!photo.corners).finally(() => {
      if (!cancelled) {
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editing, forceEdit, normalize?.photoId, selectedPhoto, setNormalize]);

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
  }, [measure, selectedPhoto?.id, editing, layoutTick]);

  const onConfirm = useCallback(async () => {
    const state = useEditor.getState();
    const session = state.normalize;
    const current = state.project;
    if (!session || !current || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const warped = await warpPhoto(session.photoId, session.corners);
      const latest = useEditor.getState().project ?? current;
      const photos = latest.photos.map((photo) =>
        photo.id === warped.id ? warped : photo,
      );
      const clips = appendClipIfNeeded(latest.clips, warped);
      setProject({ ...latest, photos, clips });
      setForceEdit(false);
      setNormalize(null);
      const next = photos.find((photo) => !photo.normalized);
      if (next) {
        setSelection({ type: "photo", id: next.id });
      } else {
        setSelection({ type: "photo", id: warped.id });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [busy, setNormalize, setProject, setSelection]);

  const onRedetect = useCallback(async () => {
    if (!selectedPhoto || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await detectIntoSession(selectedPhoto, false);
    } finally {
      setBusy(false);
    }
  }, [busy, selectedPhoto]);

  if (!project) {
    return (
      <Empty
        icon={<Monitor className="h-6 w-6" aria-hidden />}
        label="No project open"
        hint="File → New or Open to create a .picoflow project."
      />
    );
  }

  if (!selectedPhoto || !projectDir) {
    return (
      <Empty
        icon={<Monitor className="h-6 w-6" aria-hidden />}
        label="No warped frame"
        hint="Import photos from the strip, then confirm the four-corner overlay."
      />
    );
  }

  if (!editing) {
    const warped = selectedPhoto.warpedPath;
    return (
      <div className="relative flex h-full min-h-0 flex-col bg-zinc-950">
        <div className="relative min-h-0 flex-1">
          {warped ? (
            <ProjectPhoto
              projectDir={projectDir}
              relativePath={warped}
              alt="Warped screen"
              className="h-full w-full object-contain"
            />
          ) : (
            <Empty
              icon={<Monitor className="h-6 w-6" aria-hidden />}
              label="No warped frame"
              hint="Imported photos will appear here after normalize."
            />
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              setForceEdit(true);
              setNormalize(null);
            }}
          >
            <Crop className="h-3.5 w-3.5" aria-hidden />
            Adjust corners
          </button>
        </div>
      </div>
    );
  }

  const imageWidth = normalize?.imageWidth ?? selectedPhoto.width;
  const imageHeight = normalize?.imageHeight ?? selectedPhoto.height;
  const corners: Quad =
    normalize?.corners ?? insetRectangle(imageWidth, imageHeight);
  const displayed = containRect(
    { left: 0, top: 0, width: stageBox.width, height: stageBox.height },
    imageWidth,
    imageHeight,
  );
  const lowConfidence =
    (normalize?.confidence ?? 0) < DETECT_CONFIDENCE_THRESHOLD;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-zinc-950">
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <ProjectPhoto
          projectDir={projectDir}
          relativePath={selectedPhoto.rawPath}
          alt="Source photo"
          className="h-full w-full object-contain"
          onLoad={() => setLayoutTick((n) => n + 1)}
        />
        {normalize ? (
          <Handles
            corners={corners}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            displayed={displayed}
            onChange={setNormalizeCorners}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950/80 px-3 py-2">
        <p className="min-w-0 text-xs text-zinc-500">
          {!normalize && busy
            ? "Detecting screen corners…"
            : lowConfidence
              ? "Low confidence — drag the corners onto the screen."
              : "Confirm the overlay, or drag a corner to adjust."}
          {normalize ? (
            <span className="ml-2 text-zinc-600">
              {normalize.confidence.toFixed(2)}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRedetect()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Redetect
          </button>
          <button
            type="button"
            disabled={busy || !normalize}
            onClick={() => void onConfirm()}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            Confirm
          </button>
        </div>
      </div>
      {error ? (
        <p className="truncate px-3 pb-2 text-xs text-red-400" title={error}>
          {error}
        </p>
      ) : null}
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
