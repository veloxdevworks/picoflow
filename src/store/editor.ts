import { create } from "zustand";
import { totalDurationMs } from "../lib/timeline";
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
  /** Visual preview only; never sends HID. */
  playing: boolean;
  dirty: boolean;
  normalize: NormalizeSession | null;
  /** Bumped after each warp so `convertFileSrc` URLs are not reused. */
  photoRev: Record<string, number>;
  openProject: (project: Project, projectDir: string) => void;
  setProject: (project: Project) => void;
  updateProject: (updater: (project: Project) => Project) => void;
  setSelection: (selection: Selection) => void;
  setPlayheadMs: (playheadMs: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
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
  playing: false,
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
      playing: false,
      normalize: null,
      photoRev: {},
    }),
  setProject: (project) => set({ project, dirty: true }),
  updateProject: (updater) =>
    set((state) => {
      if (!state.project) {
        return state;
      }
      return { project: updater(state.project), dirty: true };
    }),
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
  play: () =>
    set((state) => {
      const total = state.project ? totalDurationMs(state.project.clips) : 0;
      if (!(total > 0)) {
        return state.playing ? { playing: false } : state;
      }
      const playheadMs = state.playheadMs >= total ? 0 : state.playheadMs;
      if (state.playing && playheadMs === state.playheadMs) {
        return state;
      }
      return { playing: true, playheadMs };
    }),
  pause: () => set((state) => (state.playing ? { playing: false } : state)),
  stop: () =>
    set((state) => {
      if (!state.playing && state.playheadMs === 0) {
        return state;
      }
      return { playing: false, playheadMs: 0 };
    }),
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
