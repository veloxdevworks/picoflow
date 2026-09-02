import { FilePen, RefreshCw } from "lucide-react";
import type { PicoVolume } from "../../types/commands";
import type { HidProfile } from "../../types/generated";
import { hidProfileLabel } from "./identity";

export function SequenceOnly({
  volume,
  runtimeVersion,
  hidProfile,
  eventCount,
  busy,
  onUpdate,
  onFullInstall,
}: {
  volume: PicoVolume;
  runtimeVersion: string;
  hidProfile: HidProfile;
  eventCount: number;
  busy: boolean;
  onUpdate: () => void;
  onFullInstall: () => void;
}) {
  const eventsLabel =
    eventCount === 0
      ? "Sequence has no events (empty is allowed)."
      : `Sequence has ${eventCount} event${eventCount === 1 ? "" : "s"}.`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-zinc-400">
        picoflow.json matches runtime {runtimeVersion} and{" "}
        {hidProfileLabel(hidProfile)}. Write sequence.json only, or hold BOOTSEL
        for a full reinstall.
      </p>
      <div className="rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400">
        <p className="font-medium text-zinc-300">{volume.label}</p>
        <p>{eventsLabel}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onUpdate}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          <FilePen className="h-3.5 w-3.5" aria-hidden />
          Update sequence only
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onFullInstall}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Full install…
        </button>
      </div>
    </div>
  );
}
