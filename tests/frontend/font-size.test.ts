import { describe, expect, test } from "vitest";
import {
  FONT_SIZE_KEY,
  readFontSize,
  resolveFontSize,
  writeFontSize
} from "../../src/frontend/font-size.js";

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

describe("font size preference", () => {
  test("uses the tmux-mobile-font-size localStorage key", () => {
    expect(FONT_SIZE_KEY).toBe("tmux-mobile-font-size");
  });

  test("resolves the default of 11 on a phone and 14 on a desktop", () => {
    expect(resolveFontSize(null, true)).toBe(11);
    expect(resolveFontSize(null, false)).toBe(14);
  });

  test("a stored value overrides the default on both phone and desktop", () => {
    expect(resolveFontSize(13, true)).toBe(13);
    expect(resolveFontSize(13, false)).toBe(13);
    expect(resolveFontSize(10, true)).toBe(10);
    expect(resolveFontSize(14, false)).toBe(14);
  });

  test("readFontSize returns the stored integer for in-range values", () => {
    for (const value of [10, 11, 12, 13, 14]) {
      expect(readFontSize(memoryStorage({ [FONT_SIZE_KEY]: String(value) }))).toBe(value);
    }
  });

  test("readFontSize returns null when no value is stored", () => {
    expect(readFontSize(memoryStorage())).toBeNull();
  });

  test("readFontSize returns null for invalid stored values", () => {
    for (const value of ["9", "15", "foo", "", "11.5"]) {
      expect(readFontSize(memoryStorage({ [FONT_SIZE_KEY]: value }))).toBeNull();
    }
  });

  test("writeFontSize stores the size as a decimal string", () => {
    const storage = memoryStorage();
    writeFontSize(storage, 11);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("11");
    writeFontSize(storage, 14);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("14");
  });

  test("writeFontSize clamps sizes below 10 and above 14", () => {
    const storage = memoryStorage();
    writeFontSize(storage, 9);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("10");
    writeFontSize(storage, 15);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("14");
    writeFontSize(storage, 0);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("10");
    writeFontSize(storage, 99);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("14");
  });

  test("round-trip: writeFontSize followed by readFontSize yields the clamped value", () => {
    const storage = memoryStorage();
    writeFontSize(storage, 12);
    expect(readFontSize(storage)).toBe(12);
    writeFontSize(storage, 7);
    expect(readFontSize(storage)).toBe(10);
  });

  test("writeFontSize normalises fractional input so the stored value is readable", () => {
    const storage = memoryStorage();
    writeFontSize(storage, 11.5);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("12");
    expect(readFontSize(storage)).toBe(12);

    writeFontSize(storage, 10.4);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("10");
    expect(readFontSize(storage)).toBe(10);

    writeFontSize(storage, 13.6);
    expect(storage.getItem(FONT_SIZE_KEY)).toBe("14");
    expect(readFontSize(storage)).toBe(14);
  });
});