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
  openProject: (project: Project, projectDir: string) => void;
  setProject: (project: Project) => void;
  setSelection: (selection: Selection) => void;
  setPlayheadMs: (playheadMs: number) => void;
  setNormalize: (normalize: NormalizeSession | null) => void;
  setNormalizeCorners: (corners: Quad) => void;
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
  openProject: (project, projectDir) =>
    set({
      project,
      projectDir,
      dirty: false,
      selection: null,
      playheadMs: 0,
      normalize: null,
    }),
  setProject: (project) => set({ project, dirty: true }),
  setSelection: (selection) => set({ selection }),
  setPlayheadMs: (playheadMs) => set({ playheadMs }),
  setNormalize: (normalize) => set({ normalize }),
  setNormalizeCorners: (corners) =>
    set((state) =>
      state.normalize ? { normalize: { ...state.normalize, corners } } : state,
    ),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}));
