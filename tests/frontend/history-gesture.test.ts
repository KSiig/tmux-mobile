import { describe, expect, test } from "vitest";
import {
  HISTORY_SWIPE_THRESHOLD_PX,
  WHEEL_PIXELS_PER_TICK,
  fingerDeltaToWheelDeltaY,
  isScrolledToLatest,
  scrollElementToLatest,
  shouldEnterHistory,
  shouldExitHistory,
  takeWheelTicks
} from "../../src/frontend/history-gesture.js";

describe("shouldEnterHistory", () => {
  test("enters history on a vertical swipe up when mouse is off", () => {
    expect(
      shouldEnterHistory({
        mouseEnabled: false,
        deltaX: 4,
        deltaY: -HISTORY_SWIPE_THRESHOLD_PX - 8
      })
    ).toBe(true);
  });

  test("does not steal TUI mouse when mouse is on", () => {
    expect(
      shouldEnterHistory({
        mouseEnabled: true,
        deltaX: 0,
        deltaY: -120
      })
    ).toBe(false);
  });

  test("ignores small or mostly-horizontal moves", () => {
    expect(shouldEnterHistory({ mouseEnabled: false, deltaX: 0, deltaY: -12 })).toBe(false);
    expect(shouldEnterHistory({ mouseEnabled: false, deltaX: 80, deltaY: -50 })).toBe(false);
  });
});

describe("shouldExitHistory", () => {
  test("returns to live on a tap", () => {
    expect(
      shouldExitHistory({
        atLatest: false,
        deltaX: 2,
        deltaY: -3,
        totalMovePx: 4
      })
    ).toBe(true);
  });

  test("returns to live when swiping down past the latest line", () => {
    expect(
      shouldExitHistory({
        atLatest: true,
        deltaX: 0,
        deltaY: HISTORY_SWIPE_THRESHOLD_PX + 10,
        totalMovePx: HISTORY_SWIPE_THRESHOLD_PX + 10
      })
    ).toBe(true);
  });

  test("does not exit while scrolling older history", () => {
    expect(
      shouldExitHistory({
        atLatest: false,
        deltaX: 0,
        deltaY: 80,
        totalMovePx: 80
      })
    ).toBe(false);
    expect(
      shouldExitHistory({
        atLatest: true,
        deltaX: 0,
        deltaY: -80,
        totalMovePx: 80
      })
    ).toBe(false);
  });
});

describe("SGR wheel encoding", () => {
  test("encodes signed ticks as SGR wheel reports", async () => {
    const { encodeSgrWheel, cellFromPoint } = await import("../../src/frontend/terminal-gestures.js");
    expect(encodeSgrWheel(2, 4, 8)).toBe("\x1b[<65;4;8M\x1b[<65;4;8M");
    expect(encodeSgrWheel(-1, 1, 1)).toBe("\x1b[<64;1;1M");
    expect(encodeSgrWheel(0, 1, 1)).toBe("");
    expect(
      cellFromPoint(50, 25, { left: 0, top: 0, width: 100, height: 100 }, 10, 10)
    ).toEqual({ col: 6, row: 3 });
  });
});

describe("wheel synthesis from a finger pan", () => {
  test("maps finger-up to wheel-up content motion (positive deltaY)", () => {
    expect(fingerDeltaToWheelDeltaY(-40)).toBe(40);
    expect(fingerDeltaToWheelDeltaY(40)).toBe(-40);
  });

  test("emits whole ticks and keeps the leftover pixels", () => {
    expect(takeWheelTicks(WHEEL_PIXELS_PER_TICK * 2 + 5)).toEqual({
      ticks: 2,
      remainder: 5
    });
    expect(takeWheelTicks(-WHEEL_PIXELS_PER_TICK - 3)).toEqual({
      ticks: -1,
      remainder: -3
    });
    expect(takeWheelTicks(10)).toEqual({ ticks: 0, remainder: 10 });
  });
});

describe("history scroll position", () => {
  test("treats the bottom of the surface as the latest output", () => {
    expect(isScrolledToLatest({ scrollTop: 400, clientHeight: 200, scrollHeight: 600 })).toBe(true);
    expect(isScrolledToLatest({ scrollTop: 0, clientHeight: 200, scrollHeight: 600 })).toBe(false);
  });

  test("anchors a history element at the latest line", () => {
    const element = { scrollTop: 0, scrollHeight: 900 };
    scrollElementToLatest(element);
    expect(element.scrollTop).toBe(900);
  });
});
