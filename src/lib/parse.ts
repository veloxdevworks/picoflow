/** Empty/whitespace is not 0. */
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function parseMs(raw: string): number | null {
  const n = parseNumber(raw);
  return n === null ? null : Math.max(0, Math.round(n));
}

export function parseIntValue(raw: string): number | null {
  const n = parseNumber(raw);
  return n === null ? null : Math.round(n);
}

/** Live-commit only when clamp is a no-op so typing `2` of `200` is not floored. */
export function liveClamped(n: number, clamp?: (n: number) => number): number | null {
  if (!clamp) {
    return n;
  }
  const next = clamp(n);
  return next === n ? n : null;
}
