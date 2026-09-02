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
  tabletSize,
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

function stillSelected(photoId: string): boolean {
  const selection = useEditor.getState().selection;
  return selection?.type === "photo" && selection.id === photoId;
}

function persistDetectOnPhoto(
  photoId: string,
  corners: Quad,
  confidence: number,
): void {
  const { project, setProject } = useEditor.getState();
  if (!project) {
    return;
  }
  const photos = project.photos.map((photo) =>
    photo.id === photoId
      ? { ...photo, corners, detectConfidence: confidence }
      : photo,
  );
  setProject({ ...project, photos });
}

async function detectIntoSession(
  photo: Photo,
  preferExisting: boolean,
): Promise<void> {
  const { setNormalize } = useEditor.getState();
  if (preferExisting && photo.corners) {
    if (!stillSelected(photo.id)) {
      return;
    }
    setNormalize({
      photoId: photo.id,
      corners: photo.corners,
      confidence: photo.detectConfidence ?? 1,
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
    persistDetectOnPhoto(photo.id, result.corners, result.confidence);
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
  const photoRev = useEditor((s) => s.photoRev);
  const setProject = useEditor((s) => s.setProject);
  const setSelection = useEditor((s) => s.setSelection);
  const setNormalize = useEditor((s) => s.setNormalize);
  const setNormalizeCorners = useEditor((s) => s.setNormalizeCorners);
  const bumpPhotoRev = useEditor((s) => s.bumpPhotoRev);

  const selectedPhoto =
    project && selection?.type === "photo"
      ? photoById(project.photos, selection.id)
      : undefined;

  const [busy, setBusy] = useState(false);
  const [warping, setWarping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceEditId, setForceEditId] = useState<string | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState<Rect>(EMPTY_RECT);

  const forceEdit =
    !!selectedPhoto && forceEditId === selectedPhoto.id;
  const session =
    selectedPhoto && normalize?.photoId === selectedPhoto.id ? normalize : null;
  const editing =
    !!selectedPhoto && (!selectedPhoto.normalized || forceEdit);

  useEffect(() => {
    setError(null);
  }, [selectedPhoto?.id]);

  useEffect(() => {
    if (normalize && normalize.photoId !== selectedPhoto?.id) {
      setNormalize(null);
    }
  }, [normalize, selectedPhoto?.id, setNormalize]);

  useEffect(() => {
    if (!selectedPhoto || !editing) {
      setBusy(false);
      return;
    }
    if (session) {
      return;
    }
    const photo = selectedPhoto;
    let cancelled = false;
    setBusy(true);
    void detectIntoSession(photo, !!photo.corners).finally(() => {
      if (!cancelled) {
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editing, forceEdit, session?.photoId, selectedPhoto]);

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
    const current = state.project;
    const selectedId =
      state.selection?.type === "photo" ? state.selection.id : null;
    const currentSession = state.normalize;
    if (
      !currentSession ||
      !current ||
      !selectedId ||
      currentSession.photoId !== selectedId ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setWarping(true);
    setError(null);
    try {
      const dest = tabletSize(current.target);
      const warped = await warpPhoto(
        currentSession.photoId,
        currentSession.corners,
        dest.width,
        dest.height,
      );
      const latest = useEditor.getState().project ?? current;
      const appended = !latest.clips.some((clip) => clip.photoId === warped.id);
      const photos = latest.photos.map((photo) =>
        photo.id === warped.id
          ? { ...warped, detectConfidence: currentSession.confidence }
          : photo,
      );
      const clips = appendClipIfNeeded(latest.clips, warped);
      setProject({ ...latest, photos, clips });
      bumpPhotoRev(warped.id);
      const live = useEditor.getState().normalize;
      if (live?.photoId === warped.id) {
        setNormalize(null);
      }
      setForceEditId((id) => (id === warped.id ? null : id));
      if (!stillSelected(warped.id)) {
        return;
      }
      if (appended) {
        const next = photos.find((photo) => !photo.normalized);
        setSelection({ type: "photo", id: next?.id ?? warped.id });
      } else {
        setSelection({ type: "photo", id: warped.id });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWarping(false);
      setBusy(false);
    }
  }, [busy, bumpPhotoRev, setNormalize, setProject, setSelection]);

  const onRedetect = useCallback(async () => {
    if (!selectedPhoto || busy || !editing) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await detectIntoSession(selectedPhoto, false);
    } finally {
      setBusy(false);
    }
  }, [busy, editing, selectedPhoto]);

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
              cacheKey={String(photoRev[selectedPhoto.id] ?? 0)}
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
              setForceEditId(selectedPhoto.id);
              if (normalize?.photoId !== selectedPhoto.id) {
                setNormalize(null);
              }
            }}
          >
            <Crop className="h-3.5 w-3.5" aria-hidden />
            Adjust corners
          </button>
        </div>
      </div>
    );
  }

  const imageWidth = session?.imageWidth ?? selectedPhoto.width;
  const imageHeight = session?.imageHeight ?? selectedPhoto.height;
  const corners: Quad =
    session?.corners ?? insetRectangle(imageWidth, imageHeight);
  const displayed = containRect(
    { left: 0, top: 0, width: stageBox.width, height: stageBox.height },
    imageWidth,
    imageHeight,
  );
  const lowConfidence =
    (session?.confidence ?? 0) < DETECT_CONFIDENCE_THRESHOLD;

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
        {session ? (
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
          {warping
            ? "Warping…"
            : !session && busy
              ? "Detecting screen corners…"
              : lowConfidence
                ? "Low confidence — drag the corners onto the screen."
                : "Confirm the overlay, or drag a corner to adjust."}
          {session ? (
            <span className="ml-2 text-zinc-600">
              {session.confidence.toFixed(2)}
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
            disabled={busy || !session}
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
