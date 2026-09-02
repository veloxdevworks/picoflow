export function Playhead({ ms, pxPerMs }: { ms: number; pxPerMs: number }) {
  if (!(pxPerMs > 0)) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-20"
      style={{ left: ms * pxPerMs }}
      title={`${ms} ms`}
      aria-hidden
    >
      <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-rose-400" />
      <div className="absolute left-1/2 top-1.5 h-[calc(100%-0.375rem)] w-px -translate-x-1/2 bg-rose-400" />
    </div>
  );
}
