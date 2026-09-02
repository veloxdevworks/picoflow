const STORAGE_KEY = "picoflow.shell-sizes";

export type ShellSizes = {
  photos: number;
  inspector: number;
  timeline: number;
};

export const DEFAULT_SHELL: ShellSizes = {
  photos: 216,
  inspector: 240,
  timeline: 200,
};

export const MIN_SHELL: ShellSizes = {
  photos: 160,
  inspector: 176,
  timeline: 128,
};

export const MAX_SHELL: ShellSizes = {
  photos: 420,
  inspector: 420,
  timeline: 420,
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}

export function clampShellSizes(sizes: ShellSizes): ShellSizes {
  return {
    photos: clamp(sizes.photos, MIN_SHELL.photos, MAX_SHELL.photos),
    inspector: clamp(sizes.inspector, MIN_SHELL.inspector, MAX_SHELL.inspector),
    timeline: clamp(sizes.timeline, MIN_SHELL.timeline, MAX_SHELL.timeline),
  };
}

export function loadShellSizes(): ShellSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SHELL;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_SHELL;
    }
    const rec = parsed as Record<string, unknown>;
    return clampShellSizes({
      photos: typeof rec.photos === "number" ? rec.photos : DEFAULT_SHELL.photos,
      inspector:
        typeof rec.inspector === "number" ? rec.inspector : DEFAULT_SHELL.inspector,
      timeline:
        typeof rec.timeline === "number" ? rec.timeline : DEFAULT_SHELL.timeline,
    });
  } catch {
    return DEFAULT_SHELL;
  }
}

export function saveShellSizes(sizes: ShellSizes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clampShellSizes(sizes)));
  } catch {
    // Quota / private mode — sizes still apply for this session.
  }
}
