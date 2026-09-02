import { describe, expect, it } from "vitest";
import type { Action, Photo, Project } from "../types/generated";
import { removePhoto, replacePhoto } from "./photos";

function photo(partial: Partial<Photo> & Pick<Photo, "id">): Photo {
  return {
    rawPath: `photos/raw/${partial.id}.jpg`,
    warpedPath: `photos/warped/${partial.id}.png`,
    corners: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    normalized: true,
    width: 100,
    height: 80,
    warpedWidth: 90,
    warpedHeight: 70,
    ...partial,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    version: 1,
    name: "Demo",
    target: {
      hidProfile: "absolute_mouse_keyboard",
      runMode: "auto",
      settleMs: 1200,
      buttonPin: "GP15",
      width: 1920,
      height: 1080,
    },
    photos: [photo({ id: "p1" }), photo({ id: "p2" })],
    clips: [
      { id: "c1", photoId: "p1", startMs: 0, durationMs: 4000 },
      { id: "c2", photoId: "p2", startMs: 4000, durationMs: 2000 },
    ],
    actions: [
      { id: "a1", atMs: 500, type: "tap", x: 0.2, y: 0.3, holdMs: 60 },
      { id: "a2", atMs: 4500, type: "tap", x: 0.8, y: 0.1, holdMs: 60 },
      { id: "a3", atMs: 5000, type: "wait", durationMs: 200 },
    ],
    ...over,
  };
}

describe("replacePhoto", () => {
  it("swaps the matching photo and invalidates warp fields from rotate", () => {
    const rotated = photo({
      id: "p1",
      width: 80,
      height: 100,
      warpedPath: null,
      corners: null,
      detectConfidence: undefined,
      normalized: false,
      warpedWidth: null,
      warpedHeight: null,
    });
    const next = replacePhoto(project(), rotated);
    expect(next.photos[0]).toEqual(rotated);
    expect(next.photos[1].id).toBe("p2");
    expect(next.clips).toHaveLength(2);
  });
});

describe("removePhoto", () => {
  it("removes the photo, its clips, and actions on those clips, then packs", () => {
    const next = removePhoto(project(), "p1");
    expect(next.photos.map((item) => item.id)).toEqual(["p2"]);
    expect(next.clips).toEqual([
      { id: "c2", photoId: "p2", startMs: 0, durationMs: 2000 },
    ]);
    expect(next.actions.map((action) => action.id)).toEqual(["a2", "a3"]);
    expect(next.actions[0].atMs).toBe(500);
    expect((next.actions[1] as Extract<Action, { type: "wait" }>).atMs).toBe(1000);
  });

  it("leaves other photos untouched when the id is unknown", () => {
    const start = project();
    expect(removePhoto(start, "missing")).toEqual({
      ...start,
      photos: start.photos,
      clips: start.clips,
      actions: start.actions,
    });
  });
});
