import type { Photo, Project } from "../types/generated";
import { actionOnClip, packClips } from "./timeline";

/** Replace one photo in place (rotate returns a new record for the same id). */
export function replacePhoto(project: Project, photo: Photo): Project {
  return {
    ...project,
    photos: project.photos.map((item) => (item.id === photo.id ? photo : item)),
  };
}

/**
 * Drop a photo, its clips, and actions that lived on those clips. Remaining
 * clips are packed; surviving actions keep their in-clip offset.
 */
export function removePhoto(project: Project, photoId: string): Project {
  const removedClips = project.clips.filter((clip) => clip.photoId === photoId);
  const remainingClips = project.clips.filter((clip) => clip.photoId !== photoId);
  const remainingActions = project.actions.filter(
    (action) => !removedClips.some((clip) => actionOnClip(action, clip)),
  );
  const snapshots = remainingActions.map((action) => {
    const clip = remainingClips.find((item) => actionOnClip(action, item));
    return {
      id: action.id,
      clipId: clip?.id ?? null,
      offset: clip ? action.atMs - clip.startMs : 0,
    };
  });
  const clips = packClips(remainingClips);
  const actions = remainingActions.flatMap((action) => {
    const snap = snapshots.find((item) => item.id === action.id);
    if (!snap?.clipId) {
      return [];
    }
    const clip = clips.find((item) => item.id === snap.clipId);
    if (!clip) {
      return [];
    }
    return [{ ...action, atMs: clip.startMs + snap.offset }];
  });
  return {
    ...project,
    photos: project.photos.filter((photo) => photo.id !== photoId),
    clips,
    actions,
  };
}
