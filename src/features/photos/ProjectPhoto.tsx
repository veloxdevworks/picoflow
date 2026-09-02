import { useEffect, useState } from "react";
import { photoUrl } from "../../lib/photoUrl";
import { readPhotoBytes } from "../../types/commands";

type Props = {
  projectDir: string;
  relativePath: string;
  alt: string;
  className?: string;
  onLoad?: () => void;
};

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

function toUint8(bytes: number[] | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
}

function assetSrc(projectDir: string, relativePath: string): string | null {
  try {
    return photoUrl(projectDir, relativePath);
  } catch {
    return null;
  }
}

/** `<img>` via `convertFileSrc`; falls back to `read_photo_bytes` on error. */
export function ProjectPhoto({
  projectDir,
  relativePath,
  alt,
  className,
  onLoad,
}: Props) {
  const [src, setSrc] = useState<string | null>(() =>
    assetSrc(projectDir, relativePath),
  );
  const [fallback, setFallback] = useState(src === null);

  useEffect(() => {
    const next = assetSrc(projectDir, relativePath);
    setSrc(next);
    setFallback(next === null);
  }, [projectDir, relativePath]);

  useEffect(() => {
    if (!fallback) {
      return;
    }
    const state: { cancelled: boolean; url?: string } = { cancelled: false };
    void (async () => {
      try {
        const bytes = await readPhotoBytes(relativePath);
        const url = URL.createObjectURL(
          new Blob([toUint8(bytes) as BlobPart], {
            type: mimeForPath(relativePath),
          }),
        );
        state.url = url;
        if (state.cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setSrc(url);
      } catch {
        if (!state.cancelled) {
          setSrc(null);
        }
      }
    })();
    return () => {
      state.cancelled = true;
      if (state.url) {
        URL.revokeObjectURL(state.url);
      }
    };
  }, [fallback, relativePath]);

  if (!src) {
    return <div className={className} aria-hidden />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onLoad={onLoad}
      onError={() => {
        if (!fallback) {
          setFallback(true);
        } else {
          setSrc(null);
        }
      }}
    />
  );
}
