import { HardDrive, Loader2 } from "lucide-react";
import type { PicoVolume, VolumeKind } from "../../types/commands";
import { hidProfileLabel, volumeKindLabel } from "./identity";

export function VolumeStatus({
  volumes,
  waitingFor,
}: {
  volumes: PicoVolume[];
  waitingFor?: VolumeKind;
}) {
  const waitingLabel = waitingFor ? volumeKindLabel(waitingFor) : null;
  const seenWait =
    waitingFor !== undefined && volumes.some((volume) => volume.kind === waitingFor);

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2">
      {waitingLabel && !seenWait ? (
        <p className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Waiting for {waitingLabel}…
        </p>
      ) : null}
      {volumes.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-zinc-600">
          <HardDrive className="h-3.5 w-3.5" aria-hidden />
          No Pico volume detected.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {volumes.map((volume) => (
            <li key={volume.id} className="flex items-start gap-2 text-xs">
              <HardDrive
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="font-medium text-zinc-300">
                  {volume.label}
                  {volume.writable ? null : (
                    <span className="ml-1.5 font-normal text-zinc-500">
                      read-only
                    </span>
                  )}
                </p>
                {volume.picoflow ? (
                  <p className="text-zinc-500">
                    PicoFlow {volume.picoflow.runtimeVersion} ·{" "}
                    {hidProfileLabel(volume.picoflow.hidProfile)}
                  </p>
                ) : volume.kind === "Circuitpy" ? (
                  <p className="text-zinc-600">No picoflow.json</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
