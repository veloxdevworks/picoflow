import type { PicoVolume, VolumeKind } from "../../types/commands";
import type { HidProfile, Sequence } from "../../types/generated";

export const SEQUENCE_SCHEMA_VERSION = 1;
export const DEFAULT_SETTLE_MS = 1200;
export const DEFAULT_BUTTON_PIN = "GP15";

/** BOOTSEL wait is human-paced (design: 120 s). */
export const BOOTSEL_TIMEOUT_MS = 120_000;
/** Post-UF2 remount is machine-paced (design: 45 s). */
export const CIRCUITPY_TIMEOUT_MS = 45_000;
export const VOLUME_POLL_MS = 400;

/** Empty events are legal; action authoring is not required for install. */
export function emptySequence(
  hidProfile: HidProfile = "absolute_mouse_keyboard",
): Sequence {
  return {
    version: SEQUENCE_SCHEMA_VERSION,
    run_mode: "auto",
    settle_ms: DEFAULT_SETTLE_MS,
    hid_profile: hidProfile,
    button_pin: DEFAULT_BUTTON_PIN,
    events: [],
  };
}

/** Exact runtime_version + hid_profile match (acceptance #7). */
export function sequenceOnlyVolume(
  volumes: readonly PicoVolume[],
  runtimeVersion: string,
  hidProfile: HidProfile,
): PicoVolume | undefined {
  return volumes.find(
    (volume) =>
      volume.kind === "Circuitpy" &&
      volume.writable &&
      volume.picoflow != null &&
      volume.picoflow.runtimeVersion === runtimeVersion &&
      volume.picoflow.hidProfile === hidProfile,
  );
}

export function firstWritable(
  volumes: readonly PicoVolume[],
  kind: VolumeKind,
): PicoVolume | undefined {
  return volumes.find((volume) => volume.kind === kind && volume.writable);
}

/** Ids already mounted as CIRCUITPY before this board's UF2 remount. */
export function circuitpyIds(volumes: readonly PicoVolume[]): Set<string> {
  return new Set(
    volumes
      .filter((volume) => volume.kind === "Circuitpy")
      .map((volume) => volume.id),
  );
}

/** Post-UF2: a writable CIRCUITPY that was not present at flash time. */
export function nextWritableCircuitpy(
  volumes: readonly PicoVolume[],
  excludeIds: ReadonlySet<string>,
): PicoVolume | undefined {
  return volumes.find(
    (volume) =>
      volume.kind === "Circuitpy" &&
      volume.writable &&
      !excludeIds.has(volume.id),
  );
}

const HARDWARE_ERROR_CODES = new Set([
  "flash_timeout",
  "volume_not_writable",
  "io",
  "not_found",
]);

/** RESET/BOOTSEL copy is for volume/flash failures; map_circuitpy_io already includes it. */
export function shouldShowResetHint(
  code: string | null,
  message: string,
): boolean {
  if (!code || !HARDWARE_ERROR_CODES.has(code)) {
    return false;
  }
  return !message.includes("Press RESET");
}

export function hidProfileLabel(profile: HidProfile): string {
  switch (profile) {
    case "absolute_mouse_keyboard":
      return "absolute mouse + keyboard";
    case "digitizer_keyboard":
      return "digitizer + keyboard";
  }
}

export function volumeKindLabel(kind: VolumeKind): string {
  return kind === "RpiRp2" ? "RPI-RP2" : "CIRCUITPY";
}
