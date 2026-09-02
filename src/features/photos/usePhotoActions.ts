import { useCallback, useEffect, useRef, useState } from "react";
import { isEditableTarget } from "../../lib/keys";
import { removePhoto, replacePhoto } from "../../lib/photos";
import { useEditor } from "../../store/editor";
import {
  deletePhoto,
  errorMessage,
  rotatePhoto,
  type RotateDegrees,
} from "../../types/commands";

export function usePhotoActions() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (op: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await op();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const selectedPhotoId = (): string | null => {
    const selection = useEditor.getState().selection;
    return selection?.type === "photo" ? selection.id : null;
  };

  const onDelete = useCallback(() => {
    const photoId = selectedPhotoId();
    const project = useEditor.getState().project;
    if (!photoId || !project || useEditor.getState().playing) {
      return;
    }
    if (!window.confirm("Delete this photo, its clips, and actions on those clips?")) {
      return;
    }
    void run(async () => {
      await deletePhoto(photoId);
      const latest = useEditor.getState().project ?? project;
      useEditor.getState().setProject(removePhoto(latest, photoId));
      const live = useEditor.getState();
      if (live.normalize?.photoId === photoId) {
        live.setNormalize(null);
      }
      if (live.selection?.type === "photo" && live.selection.id === photoId) {
        live.setSelection(null);
      }
    });
  }, [run]);

  const onRotate = useCallback(
    (degrees: RotateDegrees) => {
      const photoId = selectedPhotoId();
      if (!photoId || useEditor.getState().playing) {
        return;
      }
      void run(async () => {
        const rotated = await rotatePhoto(photoId, degrees);
        const latest = useEditor.getState().project;
        if (!latest) {
          return;
        }
        useEditor.getState().setProject(replacePhoto(latest, rotated));
        useEditor.getState().bumpPhotoRev(rotated.id);
        if (useEditor.getState().normalize?.photoId === rotated.id) {
          useEditor.getState().setNormalize(null);
        }
      });
    },
    [run],
  );

  return { busy, error, onDelete, onRotate, setError };
}

export function usePhotoDeleteShortcut(enabled: boolean, onDelete: () => void) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const selection = useEditor.getState().selection;
      if (selection?.type !== "photo") {
        return;
      }
      event.preventDefault();
      onDelete();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onDelete]);
}
