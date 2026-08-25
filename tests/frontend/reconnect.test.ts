import { describe, expect, test } from "vitest";
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  reconnectDelayMs,
  shouldReconnect,
  socketsNeedReconnect
} from "../../src/frontend/reconnect.js";

describe("shouldReconnect", () => {
  const healthy = {
    closeCode: 1006,
    socketGeneration: 1,
    currentGeneration: 1,
    unmounted: false,
    needsPassword: false,
    hasToken: true,
    authFailed: false
  };

  test("reconnects after an unexpected socket drop", () => {
    expect(shouldReconnect(healthy)).toBe(true);
  });

  test("does not reconnect for a superseded socket generation", () => {
    expect(shouldReconnect({ ...healthy, currentGeneration: 2 })).toBe(false);
  });

  test("does not reconnect after unmount", () => {
    expect(shouldReconnect({ ...healthy, unmounted: true })).toBe(false);
  });

  test("does not reconnect while waiting for a password", () => {
    expect(shouldReconnect({ ...healthy, needsPassword: true })).toBe(false);
  });

  test("does not reconnect without a token", () => {
    expect(shouldReconnect({ ...healthy, hasToken: false })).toBe(false);
  });

  test("does not reconnect after terminal auth failure", () => {
    expect(shouldReconnect({ ...healthy, closeCode: 4001 })).toBe(false);
  });

  test("does not reconnect on later lifecycle events after auth failed", () => {
    expect(shouldReconnect({ ...healthy, closeCode: undefined, authFailed: true })).toBe(false);
  });
});

describe("reconnectDelayMs", () => {
  test("reconnects immediately when asked", () => {
    expect(reconnectDelayMs(0, true)).toBe(0);
    expect(reconnectDelayMs(4, true)).toBe(0);
  });

  test("uses exponential backoff for scheduled retries", () => {
    expect(reconnectDelayMs(0, false)).toBe(RECONNECT_BASE_DELAY_MS);
    expect(reconnectDelayMs(1, false)).toBe(RECONNECT_BASE_DELAY_MS * 2);
    expect(reconnectDelayMs(2, false)).toBe(RECONNECT_BASE_DELAY_MS * 4);
  });

  test("caps backoff", () => {
    expect(reconnectDelayMs(20, false)).toBe(RECONNECT_MAX_DELAY_MS);
  });
});

describe("socketsNeedReconnect", () => {
  const OPEN = 1;
  const CLOSED = 3;

  test("needs reconnect when either socket is not open", () => {
    expect(socketsNeedReconnect(CLOSED, OPEN)).toBe(true);
    expect(socketsNeedReconnect(OPEN, CLOSED)).toBe(true);
    expect(socketsNeedReconnect(undefined, undefined)).toBe(true);
  });

  test("does not need reconnect when both sockets are open", () => {
    expect(socketsNeedReconnect(OPEN, OPEN)).toBe(false);
  });
});
