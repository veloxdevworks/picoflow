import { describe, expect, it } from "vitest";
import type { PicoVolume } from "../../types/commands";
import {
  circuitpyIds,
  emptySequence,
  firstWritable,
  nextWritableCircuitpy,
  sequenceOnlyVolume,
  shouldShowResetHint,
} from "./identity";

function volume(partial: Partial<PicoVolume> & Pick<PicoVolume, "id" | "kind">): PicoVolume {
  return {
    label: partial.kind === "RpiRp2" ? "RPI-RP2" : "CIRCUITPY",
    path: partial.id,
    writable: true,
    picoflow: null,
    ...partial,
  };
}

describe("emptySequence", () => {
  it("defaults to auto run mode and no events", () => {
    const sequence = emptySequence();
    expect(sequence.run_mode).toBe("auto");
    expect(sequence.events).toEqual([]);
    expect(sequence.hid_profile).toBe("absolute_mouse_keyboard");
    expect(sequence.settle_ms).toBe(1200);
    expect(sequence.button_pin).toBe("GP15");
  });
});

describe("sequenceOnlyVolume", () => {
  const runtime = "0.1.0";
  const profile = "absolute_mouse_keyboard" as const;

  it("offers when identity matches bundled runtime and hid profile", () => {
    const match = volume({
      id: "/Volumes/CIRCUITPY",
      kind: "Circuitpy",
      picoflow: { runtimeVersion: runtime, hidProfile: profile },
    });
    expect(sequenceOnlyVolume([match], runtime, profile)).toEqual(match);
  });

  it("refuses a runtime version mismatch", () => {
    const vols = [
      volume({
        id: "/Volumes/CIRCUITPY",
        kind: "Circuitpy",
        picoflow: { runtimeVersion: "0.2.0", hidProfile: profile },
      }),
    ];
    expect(sequenceOnlyVolume(vols, runtime, profile)).toBeUndefined();
  });

  it("refuses a hid_profile mismatch", () => {
    const vols = [
      volume({
        id: "/Volumes/CIRCUITPY",
        kind: "Circuitpy",
        picoflow: {
          runtimeVersion: runtime,
          hidProfile: "digitizer_keyboard",
        },
      }),
    ];
    expect(sequenceOnlyVolume(vols, runtime, profile)).toBeUndefined();
  });

  it("refuses missing picoflow.json", () => {
    const vols = [
      volume({
        id: "/Volumes/CIRCUITPY",
        kind: "Circuitpy",
        picoflow: null,
      }),
    ];
    expect(sequenceOnlyVolume(vols, runtime, profile)).toBeUndefined();
  });

  it("skips read-only CIRCUITPY even when identity matches", () => {
    const vols = [
      volume({
        id: "/Volumes/CIRCUITPY",
        kind: "Circuitpy",
        writable: false,
        picoflow: { runtimeVersion: runtime, hidProfile: profile },
      }),
    ];
    expect(sequenceOnlyVolume(vols, runtime, profile)).toBeUndefined();
  });
});

describe("firstWritable", () => {
  it("returns the first writable volume of the requested kind", () => {
    const rp2 = volume({ id: "/Volumes/RPI-RP2", kind: "RpiRp2" });
    const cp = volume({ id: "/Volumes/CIRCUITPY", kind: "Circuitpy" });
    expect(firstWritable([cp, rp2], "RpiRp2")).toEqual(rp2);
  });
});

describe("nextWritableCircuitpy", () => {
  it("skips CIRCUITPY ids that were mounted before the UF2 remount", () => {
    const prior = volume({ id: "/Volumes/CIRCUITPY", kind: "Circuitpy" });
    const fresh = volume({ id: "/Volumes/CIRCUITPY 1", kind: "Circuitpy" });
    const exclude = circuitpyIds([prior]);
    expect(nextWritableCircuitpy([prior, fresh], exclude)).toEqual(fresh);
  });

  it("skips a remount that is not yet writable", () => {
    const fresh = volume({
      id: "/Volumes/CIRCUITPY",
      kind: "Circuitpy",
      writable: false,
    });
    expect(nextWritableCircuitpy([fresh], new Set())).toBeUndefined();
  });
});

describe("shouldShowResetHint", () => {
  it("hides the RESET line when the command already embedded it", () => {
    expect(
      shouldShowResetHint("io", "write failed. Press RESET on the Pico and retry."),
    ).toBe(false);
  });

  it("hides the RESET line for authoring/manifest errors", () => {
    expect(shouldShowResetHint("invalid_action", "bad tap")).toBe(false);
    expect(shouldShowResetHint(null, "something")).toBe(false);
  });

  it("shows the RESET line for volume codes without that sentence", () => {
    expect(shouldShowResetHint("volume_not_writable", "CIRCUITPY is not writable")).toBe(
      true,
    );
  });
});
