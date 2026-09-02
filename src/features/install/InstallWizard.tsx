import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  CircleAlert,
  CircleCheck,
  FolderOpen,
  Loader2,
  Usb,
  X,
} from "lucide-react";
import { useEditor } from "../../store/editor";
import {
  asAppError,
  ejectVolume,
  errorMessage,
  exportSequence,
  flashUf2,
  getFirmwareManifest,
  listPicoVolumes,
  logWizardError,
  openAppLog,
  writeCircuitpy,
  writeSequenceOnly,
  type FirmwareManifest,
  type PicoVolume,
  type VolumeKind,
} from "../../types/commands";
import type { Project, RunMode, Sequence } from "../../types/generated";
import {
  BOOTSEL_TIMEOUT_MS,
  CIRCUITPY_TIMEOUT_MS,
  VOLUME_POLL_MS,
  circuitpyIds,
  emptySequence,
  firstWritable,
  nextWritableCircuitpy,
  runModeHint,
  sequenceOnlyVolume,
  shouldShowResetHint,
  volumeKindLabel,
} from "./identity";
import { SequenceOnly } from "./SequenceOnly";
import { VolumeStatus } from "./VolumeStatus";

type Phase =
  | "loading"
  | "offer"
  | "bootsel"
  | "flashing"
  | "wait-circuitpy"
  | "writing"
  | "ejecting"
  | "done"
  | "error";

type InstallMode = "full" | "sequence";

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function pollForWritable(
  kind: VolumeKind,
  timeoutMs: number,
  onVolumes: (volumes: PicoVolume[]) => void,
  signal: AbortSignal,
  pick: (volumes: PicoVolume[]) => PicoVolume | undefined,
): Promise<PicoVolume> {
  const start = Date.now();
  const label = volumeKindLabel(kind);
  for (;;) {
    if (signal.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const volumes = await listPicoVolumes();
    if (signal.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    onVolumes(volumes);
    const found = pick(volumes);
    if (found) {
      return found;
    }
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) {
      throw {
        code: "flash_timeout",
        message: `Timed out waiting for ${label}. Hold BOOTSEL, plug in USB, and retry. Press RESET if the volume is missing.`,
      };
    }
    await delay(Math.min(VOLUME_POLL_MS, timeoutMs - elapsed), signal);
  }
}

async function loadPayload(
  project: Project | null,
  fallbackRunMode: RunMode,
): Promise<{
  manifest: FirmwareManifest;
  volumes: PicoVolume[];
  sequence: Sequence;
}> {
  const [manifest, volumes, sequence] = await Promise.all([
    getFirmwareManifest(),
    listPicoVolumes(),
    project
      ? exportSequence(project)
      : Promise.resolve(
          emptySequence("absolute_mouse_keyboard", fallbackRunMode),
        ),
  ]);
  return { manifest, volumes, sequence };
}

const RUN_MODES: { value: RunMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "button", label: "Button" },
  { value: "serial", label: "Serial" },
];

/** Re-export at write time so File→Open during the wizard cannot flash a stale sequence. */
async function resolveSequence(fallbackRunMode: RunMode): Promise<Sequence> {
  const project = useEditor.getState().project;
  return project
    ? exportSequence(project)
    : emptySequence("absolute_mouse_keyboard", fallbackRunMode);
}

function phaseCopy(phase: Phase, mode: InstallMode): string {
  switch (phase) {
    case "loading":
      return "Looking for a Pico…";
    case "offer":
      return "Matching PicoFlow runtime found.";
    case "bootsel":
      return "Hold BOOTSEL on the Pico, then plug in USB. Keep holding until RPI-RP2 appears.";
    case "flashing":
      return "Copying CircuitPython onto RPI-RP2…";
    case "wait-circuitpy":
      return "Waiting for CIRCUITPY. Leave the Pico window closed until Done.";
    case "writing":
      return mode === "sequence"
        ? "Writing sequence.json…"
        : "Writing runtime and sequence. Leave the Pico window closed until Done.";
    case "ejecting":
      return "Ejecting the Pico volume…";
    case "done":
      return mode === "sequence"
        ? "Sequence updated. Unplug and plug into the tablet when ready."
        : "Unplug the Pico, then plug it into the tablet (or back into this Mac to test HID). boot.py changes apply only after that power cycle.";
    case "error":
      return "Install failed.";
  }
}

function canDismiss(phase: Phase): boolean {
  return (
    phase === "loading" ||
    phase === "offer" ||
    phase === "bootsel" ||
    phase === "wait-circuitpy" ||
    phase === "done" ||
    phase === "error"
  );
}

function pickResumeCircuitpy(
  volumes: PicoVolume[],
  lastId: string | null,
  excludeIds: ReadonlySet<string>,
): PicoVolume | undefined {
  if (lastId) {
    const same = volumes.find(
      (volume) =>
        volume.id === lastId && volume.kind === "Circuitpy" && volume.writable,
    );
    if (same) {
      return same;
    }
  }
  return nextWritableCircuitpy(volumes, excludeIds);
}

export function InstallWizard({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [fallbackRunMode, setFallbackRunMode] = useState<RunMode>("auto");
  const fallbackRunModeRef = useRef<RunMode>("auto");
  const runMode = project?.target.runMode ?? fallbackRunMode;
  fallbackRunModeRef.current = runMode;

  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const phaseRef = useRef<Phase>("loading");
  const phaseBPendingRef = useRef(false);
  const excludeCircuitpyIdsRef = useRef<Set<string>>(new Set());
  const lastCircuitpyIdRef = useRef<string | null>(null);

  const [phase, setPhaseState] = useState<Phase>("loading");
  const [mode, setMode] = useState<InstallMode>("full");
  const [volumes, setVolumes] = useState<PicoVolume[]>([]);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);
  const [offerVolume, setOfferVolume] = useState<PicoVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const begin = useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++genRef.current;
    return { signal: ac.signal, gen };
  }, []);

  const still = useCallback((gen: number) => gen === genRef.current, []);

  const fail = useCallback((gen: number, err: unknown) => {
    if (!still(gen) || isAbortError(err)) {
      return;
    }
    const app = asAppError(err);
    const message = errorMessage(err);
    const code = app?.code ?? null;
    setError(message);
    setErrorCode(code);
    void logWizardError({
      phase: phaseRef.current,
      code: code ?? "unknown",
      message,
    }).catch(() => {
      // AppLog is best-effort; the in-wizard message still shows.
    });
    setPhase("error");
  }, [setPhase, still]);

  const writeFullRuntime = useCallback(
    async (volume: PicoVolume, gen: number) => {
      lastCircuitpyIdRef.current = volume.id;
      const payload = await resolveSequence(fallbackRunModeRef.current);
      if (!still(gen)) {
        return;
      }
      setSequence(payload);
      setPhase("writing");
      await writeCircuitpy(volume.id, payload);
      phaseBPendingRef.current = false;
      if (!still(gen)) {
        return;
      }
      setPhase("ejecting");
      await ejectVolume(volume.id);
      if (!still(gen)) {
        return;
      }
      setPhase("done");
    },
    [setPhase, still],
  );

  const runFullInstall = useCallback(
    async (signal: AbortSignal, gen: number) => {
      setMode("full");
      setOfferVolume(null);
      phaseBPendingRef.current = false;
      setPhase("bootsel");
      const rp2 = await pollForWritable(
        "RpiRp2",
        BOOTSEL_TIMEOUT_MS,
        setVolumes,
        signal,
        (listed) => firstWritable(listed, "RpiRp2"),
      );
      if (!still(gen)) {
        return;
      }
      const before = await listPicoVolumes();
      if (!still(gen)) {
        return;
      }
      setVolumes(before);
      excludeCircuitpyIdsRef.current = circuitpyIds(before);
      setPhase("flashing");
      await flashUf2(rp2.id);
      phaseBPendingRef.current = true;
      if (!still(gen)) {
        return;
      }
      setPhase("wait-circuitpy");
      const exclude = excludeCircuitpyIdsRef.current;
      const circuitpy = await pollForWritable(
        "Circuitpy",
        CIRCUITPY_TIMEOUT_MS,
        setVolumes,
        signal,
        (listed) => nextWritableCircuitpy(listed, exclude),
      );
      if (!still(gen)) {
        return;
      }
      await writeFullRuntime(circuitpy, gen);
    },
    [setPhase, still, writeFullRuntime],
  );

  const resumePhaseB = useCallback(
    async (signal: AbortSignal, gen: number) => {
      setMode("full");
      setOfferVolume(null);
      setPhase("wait-circuitpy");
      const exclude = excludeCircuitpyIdsRef.current;
      const lastId = lastCircuitpyIdRef.current;
      const listed = await listPicoVolumes();
      if (!still(gen)) {
        return;
      }
      setVolumes(listed);
      const existing = pickResumeCircuitpy(listed, lastId, exclude);
      const circuitpy =
        existing ??
        (await pollForWritable(
          "Circuitpy",
          CIRCUITPY_TIMEOUT_MS,
          setVolumes,
          signal,
          (vols) => pickResumeCircuitpy(vols, lastId, exclude),
        ));
      if (!still(gen)) {
        return;
      }
      await writeFullRuntime(circuitpy, gen);
    },
    [setPhase, still, writeFullRuntime],
  );

  const runSequenceUpdate = useCallback(
    async (volume: PicoVolume, gen: number) => {
      setMode("sequence");
      const payload = await resolveSequence(fallbackRunModeRef.current);
      if (!still(gen)) {
        return;
      }
      setSequence(payload);
      setPhase("writing");
      await writeSequenceOnly(volume.id, payload);
      if (!still(gen)) {
        return;
      }
      setPhase("ejecting");
      await ejectVolume(volume.id);
      if (!still(gen)) {
        return;
      }
      setPhase("done");
    },
    [setPhase, still],
  );

  const startFromScan = useCallback(async () => {
    const { signal, gen } = begin();
    setError(null);
    setErrorCode(null);
    setLogError(null);
    phaseBPendingRef.current = false;
    lastCircuitpyIdRef.current = null;
    setPhase("loading");
    try {
      const loaded = await loadPayload(
        useEditor.getState().project,
        fallbackRunModeRef.current,
      );
      if (!still(gen)) {
        return;
      }
      setSequence(loaded.sequence);
      setRuntimeVersion(loaded.manifest.runtime.version);
      setVolumes(loaded.volumes);
      const match = sequenceOnlyVolume(
        loaded.volumes,
        loaded.manifest.runtime.version,
        loaded.sequence.hid_profile,
      );
      if (match) {
        setOfferVolume(match);
        setPhase("offer");
        return;
      }
      await runFullInstall(signal, gen);
    } catch (err) {
      fail(gen, err);
    }
  }, [begin, fail, runFullInstall, setPhase, still]);

  useEffect(() => {
    void startFromScan();
    return () => {
      abortRef.current?.abort();
    };
  }, [startFromScan]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const dismissible = canDismiss(phase);

  const requestClose = useCallback(() => {
    if (!canDismiss(phase)) {
      return;
    }
    genRef.current += 1;
    abortRef.current?.abort();
    onClose();
  }, [onClose, phase]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n" || key === "o" || key === "s") {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [requestClose]);

  const onDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const root = dialogRef.current;
    if (!root) {
      return;
    }
    const focusable = [
      ...root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const onUpdateSequence = useCallback(() => {
    if (!offerVolume) {
      return;
    }
    const { gen } = begin();
    setError(null);
    setErrorCode(null);
    void runSequenceUpdate(offerVolume, gen).catch((err) => fail(gen, err));
  }, [begin, fail, offerVolume, runSequenceUpdate]);

  const onFullInstall = useCallback(() => {
    const { signal, gen } = begin();
    setError(null);
    setErrorCode(null);
    void runFullInstall(signal, gen).catch((err) => fail(gen, err));
  }, [begin, fail, runFullInstall]);

  const onRetry = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setLogError(null);
    if (phaseBPendingRef.current) {
      const { signal, gen } = begin();
      void resumePhaseB(signal, gen).catch((err) => fail(gen, err));
      return;
    }
    void startFromScan();
  }, [begin, fail, resumePhaseB, startFromScan]);

  const onOpenLog = useCallback(() => {
    setLogError(null);
    void openAppLog().catch((err) => setLogError(errorMessage(err)));
  }, []);

  const onRunModeChange = useCallback(
    (next: RunMode) => {
      const current = useEditor.getState().project;
      if (current) {
        if (current.target.runMode === next) {
          return;
        }
        setProject({
          ...current,
          target: { ...current.target, runMode: next },
        });
      } else {
        setFallbackRunMode(next);
      }
      setSequence((seq) =>
        seq && seq.run_mode !== next ? { ...seq, run_mode: next } : seq,
      );
    },
    [setProject],
  );

  const busyWrite =
    phase === "flashing" || phase === "writing" || phase === "ejecting";
  const showResetHint =
    phase === "error" && error != null && shouldShowResetHint(errorCode, error);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50 outline-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2
            id={titleId}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-100"
          >
            <Usb className="h-4 w-4 text-zinc-400" aria-hidden />
            Install onto Pico
          </h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={!dismissible}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-4 py-4">
          <p className="text-sm leading-relaxed text-zinc-400">
            {phase === "error" && error ? error : phaseCopy(phase, mode)}
          </p>

          {phase === "offer" && offerVolume && runtimeVersion && sequence ? (
            <SequenceOnly
              volume={offerVolume}
              runtimeVersion={runtimeVersion}
              hidProfile={sequence.hid_profile}
              eventCount={sequence.events.length}
              busy={busyWrite}
              onUpdate={onUpdateSequence}
              onFullInstall={onFullInstall}
            />
          ) : null}

          {phase === "bootsel" ||
          phase === "flashing" ||
          phase === "wait-circuitpy" ||
          phase === "writing" ||
          phase === "ejecting" ||
          phase === "loading" ? (
            <VolumeStatus
              volumes={volumes}
              waitingFor={
                phase === "bootsel"
                  ? "RpiRp2"
                  : phase === "wait-circuitpy"
                    ? "Circuitpy"
                    : undefined
              }
            />
          ) : null}

          {phase === "bootsel" ? (
            <p className="text-xs leading-relaxed text-zinc-600">
              {volumes.some((volume) => volume.kind === "Circuitpy")
                ? "CIRCUITPY is mounted. Unplug, hold BOOTSEL, then plug back in. "
                : null}
              Leave Finder closed until Done. AppleDouble ._* files fill the
              CIRCUITPY volume.
            </p>
          ) : null}

          {phase === "done" ? (
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <CircleCheck className="h-4 w-4 text-emerald-400" aria-hidden />
              {mode === "sequence" ? "Sequence written." : "Install complete."}
            </div>
          ) : null}

          {showResetHint ? (
            <div className="flex items-start gap-2 text-sm text-red-400">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Press RESET on the Pico and retry. If the volume is missing,
                re-enter BOOTSEL.
              </p>
            </div>
          ) : phase === "error" ? (
            <div className="flex items-start gap-2 text-sm text-red-400">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>See the log for details.</p>
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Run mode
            </legend>
            <div className="flex flex-wrap gap-1">
              {RUN_MODES.map((option) => {
                const selected = runMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={busyWrite}
                    aria-pressed={selected}
                    onClick={() => onRunModeChange(option.value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                      selected
                        ? "bg-zinc-100 text-zinc-900"
                        : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-600">
              {runModeHint(runMode)}
              {sequence
                ? ` · ${sequence.events.length} event${sequence.events.length === 1 ? "" : "s"}`
                : null}
            </p>
          </fieldset>

          {logError ? (
            <p className="text-xs text-red-400" title={logError}>
              {logError}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          {phase === "error" ? (
            <>
              <button
                type="button"
                onClick={onOpenLog}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                Open log
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
              >
                Retry
              </button>
            </>
          ) : phase === "done" ? (
            <button
              type="button"
              onClick={requestClose}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Done
            </button>
          ) : phase === "offer" ? null : (
            <button
              type="button"
              onClick={requestClose}
              disabled={!dismissible}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
            >
              {phase === "loading" ||
              phase === "bootsel" ||
              phase === "wait-circuitpy" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {busyWrite ? "Working…" : "Cancel"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
