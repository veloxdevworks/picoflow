import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  ejectVolume,
  errorMessage,
  exportSequence,
  flashUf2,
  getFirmwareManifest,
  listPicoVolumes,
  openAppLog,
  waitForVolume,
  writeCircuitpy,
  writeSequenceOnly,
  type FirmwareManifest,
  type PicoVolume,
} from "../../types/commands";
import type { Project, Sequence } from "../../types/generated";
import {
  BOOTSEL_TIMEOUT_MS,
  CIRCUITPY_TIMEOUT_MS,
  VOLUME_POLL_MS,
  emptySequence,
  firstWritable,
  sequenceOnlyVolume,
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

async function pollForRp2(
  onVolumes: (volumes: PicoVolume[]) => void,
  signal: AbortSignal,
): Promise<PicoVolume> {
  const start = Date.now();
  for (;;) {
    if (signal.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const volumes = await listPicoVolumes();
    if (signal.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    onVolumes(volumes);
    const found = firstWritable(volumes, "RpiRp2");
    if (found) {
      return found;
    }
    const elapsed = Date.now() - start;
    if (elapsed >= BOOTSEL_TIMEOUT_MS) {
      throw new Error(
        "Timed out waiting for RPI-RP2. Hold BOOTSEL, plug in USB, and retry. Press RESET if the volume is missing.",
      );
    }
    await delay(Math.min(VOLUME_POLL_MS, BOOTSEL_TIMEOUT_MS - elapsed), signal);
  }
}

async function loadPayload(project: Project | null): Promise<{
  manifest: FirmwareManifest;
  volumes: PicoVolume[];
  sequence: Sequence;
}> {
  const [manifest, volumes, sequence] = await Promise.all([
    getFirmwareManifest(),
    listPicoVolumes(),
    project ? exportSequence(project) : Promise.resolve(emptySequence()),
  ]);
  return { manifest, volumes, sequence };
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

export function InstallWizard({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const project = useEditor((s) => s.project);

  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<InstallMode>("full");
  const [volumes, setVolumes] = useState<PicoVolume[]>([]);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);
  const [offerVolume, setOfferVolume] = useState<PicoVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

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
    setError(errorMessage(err));
    setPhase("error");
  }, [still]);

  const runFullInstall = useCallback(
    async (signal: AbortSignal, payload: Sequence, gen: number) => {
      setMode("full");
      setOfferVolume(null);
      setPhase("bootsel");
      const rp2 = await pollForRp2(setVolumes, signal);
      if (!still(gen)) {
        return;
      }
      setPhase("flashing");
      await flashUf2(rp2.id);
      if (!still(gen)) {
        return;
      }
      setPhase("wait-circuitpy");
      const circuitpy = await waitForVolume("Circuitpy", CIRCUITPY_TIMEOUT_MS);
      if (!still(gen)) {
        return;
      }
      setVolumes([circuitpy]);
      setPhase("writing");
      await writeCircuitpy(circuitpy.id, payload);
      if (!still(gen)) {
        return;
      }
      setPhase("ejecting");
      await ejectVolume(circuitpy.id);
      if (!still(gen)) {
        return;
      }
      setPhase("done");
    },
    [still],
  );

  const runSequenceUpdate = useCallback(
    async (volume: PicoVolume, payload: Sequence, gen: number) => {
      setMode("sequence");
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
    [still],
  );

  const startFromScan = useCallback(async () => {
    const { signal, gen } = begin();
    setError(null);
    setLogError(null);
    setPhase("loading");
    try {
      const loaded = await loadPayload(useEditor.getState().project);
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
      await runFullInstall(signal, loaded.sequence, gen);
    } catch (err) {
      fail(gen, err);
    }
  }, [begin, fail, runFullInstall, still]);

  useEffect(() => {
    void startFromScan();
    return () => {
      abortRef.current?.abort();
    };
  }, [startFromScan]);

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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const onUpdateSequence = useCallback(() => {
    if (!sequence || !offerVolume) {
      return;
    }
    const { gen } = begin();
    setError(null);
    void runSequenceUpdate(offerVolume, sequence, gen).catch((err) =>
      fail(gen, err),
    );
  }, [begin, fail, offerVolume, runSequenceUpdate, sequence]);

  const onFullInstall = useCallback(() => {
    if (!sequence) {
      return;
    }
    const { signal, gen } = begin();
    setError(null);
    void runFullInstall(signal, sequence, gen).catch((err) => fail(gen, err));
  }, [begin, fail, runFullInstall, sequence]);

  const onOpenLog = useCallback(() => {
    setLogError(null);
    void openAppLog().catch((err) => setLogError(errorMessage(err)));
  }, []);

  const busyWrite =
    phase === "flashing" || phase === "writing" || phase === "ejecting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
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

          {phase === "error" ? (
            <div className="flex items-start gap-2 text-sm text-red-400">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Press RESET on the Pico and retry. If the volume is missing,
                re-enter BOOTSEL.
              </p>
            </div>
          ) : null}

          <p className="text-[11px] text-zinc-600">
            Run mode: {sequence?.run_mode ?? project?.target.runMode ?? "auto"}
            {sequence
              ? ` · ${sequence.events.length} event${sequence.events.length === 1 ? "" : "s"}`
              : null}
          </p>

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
                onClick={() => void startFromScan()}
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
