import { invoke } from "@tauri-apps/api/core";
import type { Project, Sequence } from "./generated";

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

/** Native save dialog lives in Rust; pass a name hint or `""` for Untitled. */
export function createProject(name: string): Promise<Project> {
  return invoke<Project>("create_project", { name });
}

export function loadProject(): Promise<Project> {
  return invoke<Project>("load_project");
}

export function saveProject(project: Project): Promise<void> {
  return invoke("save_project", { project });
}

export function duplicateProject(): Promise<Project> {
  return invoke<Project>("duplicate_project");
}

export function exportSequence(project: Project): Promise<Sequence> {
  return invoke<Sequence>("export_sequence", { project });
}

export function writeSequenceFile(sequence: Sequence): Promise<void> {
  return invoke("write_sequence_file", { sequence });
}
