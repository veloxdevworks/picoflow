import { create } from "zustand";
import type { Quad } from "../types/commands";
import type { Project } from "../types/generated";

export type Selection =
  | { type: "photo"; id: string }
  | { type: "clip"; id: string }
  | { type: "action"; id: string }
  | null;

/** In-progress four-corner warp for one raw photo. */
export type NormalizeSession = {
  photoId: string;
  corners: Quad;
  confidence: number;
  imageWidth: number;
  imageHeight: number;
};

type EditorState = {
  project: Project | null;
  /** Absolute project folder so `photoUrl` can call convertFileSrc. */
  projectDir: string | null;
  selection: Selection;
  playheadMs: number;
  dirty: boolean;
  normalize: NormalizeSession | null;
  /** Bumped after each warp so `convertFileSrc` URLs are not reused. */
  photoRev: Record<string, number>;
  openProject: (project: Project, projectDir: string) => void;
  setProject: (project: Project) => void;
  setSelection: (selection: Selection) => void;
  setPlayheadMs: (playheadMs: number) => void;
  setNormalize: (normalize: NormalizeSession | null) => void;
  setNormalizeCorners: (corners: Quad) => void;
  bumpPhotoRev: (photoId: string) => void;
  markDirty: () => void;
  markClean: () => void;
};

export const useEditor = create<EditorState>((set) => ({
  project: null,
  projectDir: null,
  selection: null,
  playheadMs: 0,
  dirty: false,
  normalize: null,
  photoRev: {},
  openProject: (project, projectDir) =>
    set({
      project,
      projectDir,
      dirty: false,
      selection: null,
      playheadMs: 0,
      normalize: null,
      photoRev: {},
    }),
  setProject: (project) => set({ project, dirty: true }),
  setSelection: (selection) =>
    set((state) => {
      const current = state.selection;
      if (current === selection) {
        return state;
      }
      if (
        current &&
        selection &&
        current.type === selection.type &&
        current.id === selection.id
      ) {
        return state;
      }
      return { selection };
    }),
  setPlayheadMs: (playheadMs) =>
    set((state) => (state.playheadMs === playheadMs ? state : { playheadMs })),
  setNormalize: (normalize) => set({ normalize }),
  setNormalizeCorners: (corners) =>
    set((state) =>
      state.normalize ? { normalize: { ...state.normalize, corners } } : state,
    ),
  bumpPhotoRev: (photoId) =>
    set((state) => ({
      photoRev: { ...state.photoRev, [photoId]: (state.photoRev[photoId] ?? 0) + 1 },
    })),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}));
