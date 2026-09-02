import { describe, expect, it } from "vitest";
import { canonicalKeycode } from "./KeyPicker";

describe("canonicalKeycode", () => {
  it("accepts Keycode names case-insensitively", () => {
    expect(canonicalKeycode("ENTER")).toBe("ENTER");
    expect(canonicalKeycode("enter")).toBe("ENTER");
    expect(canonicalKeycode("  Tab  ")).toBe("TAB");
    expect(canonicalKeycode("A")).toBe("A");
  });

  it("rejects empty and unknown names", () => {
    expect(canonicalKeycode("")).toBeNull();
    expect(canonicalKeycode("   ")).toBeNull();
    expect(canonicalKeycode("EN")).toBeNull();
    expect(canonicalKeycode("Returnn")).toBeNull();
  });
});
