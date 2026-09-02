import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isApplePlatform, isEditableTarget } from "../../lib/keys";
import { useEditor } from "../../store/editor";
import {
  createProject,
  duplicateProject,
  errorMessage,
  exportSequence,
  isCanceled,
  loadProject,
  saveProject,
  writeSequenceFile,
} from "../../types/commands";

function confirmDiscard(dirty: boolean): boolean {
  if (!dirty) {
    return true;
  }
  return window.confirm("Discard unsaved changes?");
}

function shortcutMod(): string {
  return isApplePlatform() ? "⌘" : "Ctrl+";
}

export function ProjectMenu({
  shortcutsEnabled = true,
}: {
  shortcutsEnabled?: boolean;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mod = shortcutMod();

  const project = useEditor((s) => s.project);
  const openProject = useEditor((s) => s.openProject);
  const commitSave = useEditor((s) => s.commitSave);
  const markDirty = useEditor((s) => s.markDirty);

  const run = useCallback(async (op: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setOpen(false);
    try {
      await op();
    } catch (err) {
      if (!isCanceled(err)) {
        setError(errorMessage(err));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const onNew = useCallback(() => {
    void run(async () => {
      if (!confirmDiscard(useEditor.getState().dirty)) {
        return;
      }
      const created = await createProject("");
      openProject(created.project, created.projectDir);
      if (created.untitled) {
        markDirty();
      }
    });
  }, [markDirty, openProject, run]);

  const onOpen = useCallback(() => {
    void run(async () => {
      if (!confirmDiscard(useEditor.getState().dirty)) {
        return;
      }
      const loaded = await loadProject();
      openProject(loaded.project, loaded.projectDir);
    });
  }, [openProject, run]);

  const onSave = useCallback(() => {
    void run(async () => {
      const current = useEditor.getState().project;
      if (!current) {
        return;
      }
      const saved = await saveProject(current);
      commitSave(saved.project, saved.projectDir);
    });
  }, [commitSave, run]);

  const onDuplicate = useCallback(() => {
    void run(async () => {
      const current = useEditor.getState().project;
      if (!current) {
        return;
      }
      if (useEditor.getState().dirty) {
        const saved = await saveProject(current);
        commitSave(saved.project, saved.projectDir);
      }
      const copied = await duplicateProject();
      openProject(copied.project, copied.projectDir);
    });
  }, [commitSave, openProject, run]);

  const onExport = useCallback(() => {
    void run(async () => {
      const current = useEditor.getState().project;
      if (!current) {
        return;
      }
      const sequence = await exportSequence(current);
      await writeSequenceFile(sequence);
    });
  }, [run]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!isTauri() || !shortcutsEnabled) {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("picoflow-menu", (event) => {
      switch (event.payload) {
        case "new":
          onNew();
          break;
        case "open":
          onOpen();
          break;
        case "save":
          onSave();
          break;
        case "duplicate":
          onDuplicate();
          break;
        case "export":
          onExport();
          break;
        default:
          break;
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onDuplicate, onExport, onNew, onOpen, onSave, shortcutsEnabled]);

  useEffect(() => {
    if (!shortcutsEnabled) {
      setOpen(false);
      return;
    }
    // Native macOS File items already have Cmd accelerators; a second JS
    // handler would double-fire New/Open/Save.
    if (isTauri() && isApplePlatform()) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        onNew();
      } else if (key === "o") {
        event.preventDefault();
        onOpen();
      } else if (key === "s") {
        event.preventDefault();
        onSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNew, onOpen, onSave, shortcutsEnabled]);

  useEffect(() => {
    if (!isTauri()) {
      function onBeforeUnload(event: BeforeUnloadEvent) {
        if (!useEditor.getState().dirty) {
          return;
        }
        event.preventDefault();
        event.returnValue = "";
      }
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (useEditor.getState().dirty && !confirmDiscard(true)) {
          event.preventDefault();
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const hasProject = project !== null;
  const nativeMacFileMenu = isTauri() && isApplePlatform();

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center gap-3">
      {nativeMacFileMenu ? null : (
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={busy || !shortcutsEnabled}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 disabled:opacity-50"
      >
        File
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
      </button>
      )}
      {open && !nativeMacFileMenu ? (
        <div
          id={menuId}
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 min-w-[13.5rem] rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-xl shadow-black/40"
        >
          <MenuItem label="New" shortcut={`${mod}N`} onClick={onNew} />
          <MenuItem label="Open…" shortcut={`${mod}O`} onClick={onOpen} />
          <MenuItem
            label="Save"
            shortcut={`${mod}S`}
            disabled={!hasProject}
            onClick={onSave}
          />
          <MenuItem
            label="Duplicate…"
            disabled={!hasProject}
            onClick={onDuplicate}
          />
          <div className="my-1 border-t border-zinc-800" />
          <MenuItem
            label="Export sequence…"
            disabled={!hasProject}
            onClick={onExport}
          />
        </div>
      ) : null}
      {error ? (
        <p className="max-w-xs truncate text-xs text-red-400" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
    >
      <span>{label}</span>
      {shortcut ? (
        <span className="text-[11px] text-zinc-500">{shortcut}</span>
      ) : null}
    </button>
  );
}
