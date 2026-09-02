import { convertFileSrc } from "@tauri-apps/api/core";

/** Join a session project dir with a project-relative photo path (`photos/raw|warped/…`). */
export function photoFilePath(projectDir: string, relativePath: string): string {
  const dir = projectDir.replace(/[/\\]+$/, "");
  const rel = relativePath.replace(/^[/\\]+/, "");
  return `${dir}/${rel}`;
}

/** Asset-protocol URL for `<img>` / canvas. Scope is granted in Rust on New/Open. */
export function photoUrl(
  projectDir: string,
  relativePath: string,
  cacheKey?: string,
): string {
  const url = convertFileSrc(photoFilePath(projectDir, relativePath));
  if (!cacheKey) {
    return url;
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(cacheKey)}`;
}
