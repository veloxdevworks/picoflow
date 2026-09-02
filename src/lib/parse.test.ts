import { describe, expect, it } from "vitest";
import { liveClamped, parseIntValue, parseMs, parseNumber } from "./parse";

describe("parseNumber", () => {
  it("treats empty and whitespace as null, not 0", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
    expect(Number("")).toBe(0);
  });

  it("parses finite numbers and rejects junk", () => {
    expect(parseNumber("0")).toBe(0);
    expect(parseNumber("200")).toBe(200);
    expect(parseNumber("0.5")).toBe(0.5);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
  });
});

describe("parseMs", () => {
  it("rounds and floors at 0, still null for empty", () => {
    expect(parseMs("")).toBeNull();
    expect(parseMs("2")).toBe(2);
    expect(parseMs("1.6")).toBe(2);
    expect(parseMs("-4")).toBe(0);
  });
});

describe("parseIntValue", () => {
  it("allows negatives and null empty", () => {
    expect(parseIntValue("")).toBeNull();
    expect(parseIntValue("-3.2")).toBe(-3);
  });
});

describe("liveClamped", () => {
  it("skips values that would be raised by a min clamp", () => {
    const min16 = (n: number) => Math.max(16, n);
    expect(liveClamped(2, min16)).toBeNull();
    expect(liveClamped(16, min16)).toBe(16);
    expect(liveClamped(200, min16)).toBe(200);
    expect(liveClamped(2)).toBe(2);
  });
});
