import { describe, expect, it } from "vitest";
import type { Action, Clip } from "../types/generated";
import clipAtFixture from "../../crates/picoflow-core/tests/fixtures/timeline/clip_at.json";
import { clipAt, upcomingKeyframe } from "./timeline";

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
