import { invoke } from "@tauri-apps/api/core";
import type { HidProfile, Photo, Point, Project, Sequence } from "./generated";

/** IPC error payload from Rust `AppError`. */
export type AppError = {
  code: string;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function asAppError(err: unknown): AppError | null {
  const direct = asRecord(err);
  const fromMessage = err instanceof Error ? asRecord(err.message) : null;
  const record = direct ?? fromMessage;
  if (!record) {
    return null;
  }
  const nested = record.error;
  const payload =
    typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)
      : record;
  const { code, message } = payload;
  if (typeof code === "string" && typeof message === "string") {
    return { code, message };
  }
  return null;
}

export function isCanceled(err: unknown): boolean {
  return asAppError(err)?.code === "canceled";
}

export function errorMessage(err: unknown): string {
  const app = asAppError(err);
  if (app) {
    return app.message;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err.length > 0) {
    return err;
  }
  return "Something went wrong";
}

/** Dialog dest flows out so `convertFileSrc` can run; JS never supplies dest. */
export type OpenedProject = {
  project: Project;
  projectDir: string;
  untitled: boolean;
};

/** Starts a temp untitled project; Save picks the `.picoflow` dest. */
export function createProject(name: string): Promise<OpenedProject> {
  return invoke<OpenedProject>("create_project", { name });
}

export function loadProject(): Promise<OpenedProject> {
  return invoke<OpenedProject>("load_project");
}

export function saveProject(project: Project): Promise<OpenedProject> {
  return invoke<OpenedProject>("save_project", { project });
}

export function duplicateProject(): Promise<OpenedProject> {
  return invoke<OpenedProject>("duplicate_project");
}

export function exportSequence(project: Project): Promise<Sequence> {
  return invoke<Sequence>("export_sequence", { project });
}

export function writeSequenceFile(sequence: Sequence): Promise<void> {
  return invoke("write_sequence_file", { sequence });
}

export type DetectResult = {
  corners: [Point, Point, Point, Point];
  confidence: number;
  imageWidth: number;
  imageHeight: number;
};

export type Quad = [Point, Point, Point, Point];

/** Native multi-file picker. Paths must be passed unchanged to `importPhotos`. */
export function pickImportPhotos(): Promise<string[]> {
  return invoke<string[]>("pick_import_photos");
}

export const IMPORT_PROGRESS_EVENT = "photos:import-progress";

export type ImportPhase = "converting" | "copied";

export type ImportProgress = {
  current: number;
  total: number;
  filename: string;
  phase: ImportPhase;
  photo?: Photo;
  error?: string;
};

export function importPhotos(paths: string[]): Promise<Photo[]> {
  return invoke<Photo[]>("import_photos", { paths });
}

export function detectScreenQuad(photoId: string): Promise<DetectResult> {
  return invoke<DetectResult>("detect_screen_quad", { photoId });
}

export function warpPhoto(
  photoId: string,
  corners: Quad,
  destWidth: number,
  destHeight: number,
): Promise<Photo> {
  return invoke<Photo>("warp_photo", { photoId, corners, destWidth, destHeight });
}

export type RotateDegrees = 90 | 180 | 270;

export function rotatePhoto(
  photoId: string,
  degrees: RotateDegrees,
): Promise<Photo> {
  return invoke<Photo>("rotate_photo", { photoId, degrees });
}

export function deletePhoto(photoId: string): Promise<void> {
  return invoke("delete_photo", { photoId });
}

/** Fallback when `convertFileSrc` cannot load a project photo. */
export function readPhotoBytes(relativePath: string): Promise<number[]> {
  return invoke<number[]>("read_photo_bytes", { relativePath });
}

export type VolumeKind = "RpiRp2" | "Circuitpy";

export type PicoflowIdentity = {
  runtimeVersion: string;
  hidProfile: HidProfile;
};

export type PicoVolume = {
  id: string;
  kind: VolumeKind;
  label: string;
  path: string;
  writable: boolean;
  picoflow: PicoflowIdentity | null;
};

export type FirmwareManifest = {
  schemaVersion: number;
  circuitpython: {
    version: string;
    board: string;
    language: string;
    uf2: string;
    sha256: string;
  };
  runtime: {
    version: string;
    entry: { code: string; defaultSequence: string; identity: string };
    lib: string[];
  };
  hidProfiles: Record<HidProfile, { boot: string }>;
};

export function getFirmwareManifest(): Promise<FirmwareManifest> {
  return invoke<FirmwareManifest>("get_firmware_manifest");
}

export function listPicoVolumes(): Promise<PicoVolume[]> {
  return invoke<PicoVolume[]>("list_pico_volumes");
}

export function flashUf2(volumeId: string): Promise<void> {
  return invoke("flash_uf2", { volumeId });
}

export function waitForVolume(
  kind: VolumeKind,
  timeoutMs: number,
): Promise<PicoVolume> {
  return invoke<PicoVolume>("wait_for_volume", { kind, timeoutMs });
}

export function writeCircuitpy(
  volumeId: string,
  sequence: Sequence,
): Promise<void> {
  return invoke("write_circuitpy", { volumeId, sequence });
}

export function writeSequenceOnly(
  volumeId: string,
  sequence: Sequence,
): Promise<void> {
  return invoke("write_sequence_only", { volumeId, sequence });
}

export function ejectVolume(volumeId: string): Promise<void> {
  return invoke("eject_volume", { volumeId });
}

/** Reveal the Tauri AppLog directory (Finder / `open` argv). */
export function openAppLog(): Promise<void> {
  return invoke("open_app_log");
}

/** Write a wizard failure into the tracing AppLog file. */
export function logWizardError(args: {
  phase: string;
  code: string;
  message: string;
}): Promise<void> {
  return invoke("log_wizard_error", args);
}

/** IPC on pointer-up. Live edge drag is CSS-only. */
export function rippleClip(
  project: Project,
  clipId: string,
  newDurationMs: number,
): Promise<Project> {
  return invoke<Project>("ripple_clip", { project, clipId, newDurationMs });
}

export function reorderClips(
  project: Project,
  orderedClipIds: string[],
): Promise<Project> {
  return invoke<Project>("reorder_clips", { project, orderedClipIds });
}

export function insertWait(
  project: Project,
  atMs: number,
  durationMs: number,
): Promise<Project> {
  return invoke<Project>("insert_wait", { project, atMs, durationMs });
}
