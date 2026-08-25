import { describe, expect, test } from "vitest";
import {
  MOUSE_PREFERENCE_KEY,
  readMousePreference,
  resolveMouseEnabled,
  writeMousePreference
} from "../../src/frontend/mouse-preference.js";

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear: () => {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    },
    getItem: (key: string) => data[key] ?? null,
    key: (index: number) => Object.keys(data)[index] ?? null,
    removeItem: (key: string) => {
      delete data[key];
    },
    setItem: (key: string, value: string) => {
      data[key] = value;
    }
  };
};

describe("mouse preference", () => {
  test("reads true/false and ignores unknown values", () => {
    expect(readMousePreference(memoryStorage({ [MOUSE_PREFERENCE_KEY]: "true" }))).toBe(true);
    expect(readMousePreference(memoryStorage({ [MOUSE_PREFERENCE_KEY]: "false" }))).toBe(false);
    expect(readMousePreference(memoryStorage({ [MOUSE_PREFERENCE_KEY]: "on" }))).toBeNull();
    expect(readMousePreference(memoryStorage())).toBeNull();
  });

  test("persists the last explicit choice", () => {
    const storage = memoryStorage();
    writeMousePreference(storage, true);
    expect(storage.getItem(MOUSE_PREFERENCE_KEY)).toBe("true");
    writeMousePreference(storage, false);
    expect(readMousePreference(storage)).toBe(false);
  });

  test("stored choice wins over the live tmux value", () => {
    expect(resolveMouseEnabled(true, false)).toBe(true);
    expect(resolveMouseEnabled(false, true)).toBe(false);
    expect(resolveMouseEnabled(null, true)).toBe(true);
    expect(resolveMouseEnabled(null, false)).toBe(false);
  });
});
