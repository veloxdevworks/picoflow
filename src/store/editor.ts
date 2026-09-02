import { create } from "zustand";
import type { Project } from "../types/generated";

export type Selection =
  | { type: "photo"; id: string }
  | { type: "clip"; id: string }
  | { type: "action"; id: string }
  | null;

type EditorState = {
  project: Project | null;
  /** Absolute project folder so `photoUrl` can call convertFileSrc. */
  projectDir: string | null;
  selection: Selection;
  playheadMs: number;
  dirty: boolean;
  openProject: (project: Project, projectDir?: string | null) => void;
  setProject: (project: Project) => void;
  setSelection: (selection: Selection) => void;
  setPlayheadMs: (playheadMs: number) => void;
  markDirty: () => void;
  markClean: () => void;
};

export const useEditor = create<EditorState>((set) => ({
  project: null,
  projectDir: null,
  selection: null,
  playheadMs: 0,
  dirty: false,
  openProject: (project, projectDir = null) =>
    set({
      project,
      projectDir,
      dirty: false,
      selection: null,
      playheadMs: 0,
    }),
  setProject: (project) => set({ project, dirty: true }),
  setSelection: (selection) => set({ selection }),
  setPlayheadMs: (playheadMs) => set({ playheadMs }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}));
