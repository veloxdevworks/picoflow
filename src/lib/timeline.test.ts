import { describe, expect, it } from "vitest";
import type { Action, Clip } from "../types/generated";
import clipAtFixture from "../../crates/picoflow-core/tests/fixtures/timeline/clip_at.json";
import {
  actionOnClip,
  clampActionAtMs,
  clampClipDurationMs,
  clampPlayheadMs,
  clipAt,
  MIN_CLIP_DURATION_MS,
  totalDurationMs,
  upcomingKeyframe,
} from "./timeline";

type ClipAtCase = { ms: number; clipId: string | null };
type UpcomingCase = { ms: number; actionId: string | null };
type Scenario = {
  name: string;
  clips: Clip[];
  actions: Action[];
  clipAt: ClipAtCase[];
  upcoming: UpcomingCase[];
};

const fixture = clipAtFixture as { scenarios: Scenario[] };

describe("clipAt", () => {
  for (const scenario of fixture.scenarios) {
    for (const testCase of scenario.clipAt) {
      it(`${scenario.name} ms=${testCase.ms}`, () => {
        const found = clipAt(scenario.clips, testCase.ms);
        expect(found?.id ?? null).toBe(testCase.clipId);
      });
    }
  }
});

describe("totalDurationMs", () => {
  it("is 0 for no clips and end of the last clip otherwise", () => {
    expect(totalDurationMs([])).toBe(0);
    expect(
      totalDurationMs([
        { id: "a", photoId: "p", startMs: 0, durationMs: 4000 },
        { id: "b", photoId: "q", startMs: 4000, durationMs: 2000 },
      ]),
    ).toBe(6000);
  });
});

describe("clampClipDurationMs", () => {
  it("enforces the 200ms floor", () => {
    expect(clampClipDurationMs(Number.NaN)).toBe(MIN_CLIP_DURATION_MS);
    expect(clampClipDurationMs(0)).toBe(MIN_CLIP_DURATION_MS);
    expect(clampClipDurationMs(199)).toBe(MIN_CLIP_DURATION_MS);
    expect(clampClipDurationMs(200)).toBe(200);
    expect(clampClipDurationMs(1500.4)).toBe(1500);
  });
});

describe("clampPlayheadMs", () => {
  it("stays inside [0, total]", () => {
    expect(clampPlayheadMs(-10, 4000)).toBe(0);
    expect(clampPlayheadMs(0, 4000)).toBe(0);
    expect(clampPlayheadMs(4000, 4000)).toBe(4000);
    expect(clampPlayheadMs(9000, 4000)).toBe(4000);
    expect(clampPlayheadMs(100, 0)).toBe(0);
  });
});

describe("clampActionAtMs", () => {
  it("stays inside [0, total)", () => {
    expect(clampActionAtMs(-10, 4000)).toBe(0);
    expect(clampActionAtMs(0, 4000)).toBe(0);
    expect(clampActionAtMs(1800, 4000)).toBe(1800);
    expect(clampActionAtMs(4000, 4000)).toBe(3999);
    expect(clampActionAtMs(9000, 4000)).toBe(3999);
    expect(clampActionAtMs(100, 0)).toBe(0);
    expect(clampActionAtMs(Number.NaN, 4000)).toBe(0);
  });
});

describe("actionOnClip", () => {
  const clip: Clip = { id: "c", photoId: "p", startMs: 4000, durationMs: 2000 };
  it("uses a half-open interval", () => {
    expect(actionOnClip({ id: "a", atMs: 3999, type: "wait", durationMs: 0 }, clip)).toBe(
      false,
    );
    expect(actionOnClip({ id: "a", atMs: 4000, type: "wait", durationMs: 0 }, clip)).toBe(
      true,
    );
    expect(actionOnClip({ id: "a", atMs: 5999, type: "wait", durationMs: 0 }, clip)).toBe(
      true,
    );
    expect(actionOnClip({ id: "a", atMs: 6000, type: "wait", durationMs: 0 }, clip)).toBe(
      false,
    );
  });
});

describe("upcomingKeyframe", () => {
  for (const scenario of fixture.scenarios) {
    for (const testCase of scenario.upcoming) {
      it(`${scenario.name} ms=${testCase.ms}`, () => {
        const found = upcomingKeyframe(scenario.actions, testCase.ms);
        expect(found?.id ?? null).toBe(testCase.actionId);
      });
    }
  }
});
