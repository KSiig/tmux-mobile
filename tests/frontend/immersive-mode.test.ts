import { describe, expect, test } from "vitest";
import {
  IMMERSIVE_KEY,
  HINT_SEEN_KEY,
  readImmersive,
  writeImmersive,
  resolveImmersive,
  readHintSeen,
  writeHintSeen,
  isPhoneMatch
} from "../../src/frontend/immersive-mode.js";

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

class FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((event: MediaQueryListEvent) => void) | null = null;

  constructor(matches: boolean) {
    this.matches = matches;
    this.media = "(max-width: 768px), (pointer: coarse)";
  }

  // Required by the MediaQueryList interface but unused in these tests.
  addEventListener(): void {}
  removeEventListener(): void {}
  addListener(): void {}
  removeListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}

describe("immersive mode preference", () => {
  test("uses the tmux-mobile-immersive localStorage key", () => {
    expect(IMMERSIVE_KEY).toBe("tmux-mobile-immersive");
  });

  test("uses the tmux-mobile-immersive-hint-seen localStorage key", () => {
    expect(HINT_SEEN_KEY).toBe("tmux-mobile-immersive-hint-seen");
  });

  test("resolveImmersive defaults to false on phone and desktop when no stored value", () => {
    expect(resolveImmersive(null, true)).toBe(false);
    expect(resolveImmersive(null, false)).toBe(false);
  });

  test("resolveImmersive lets the stored value win on both phone and desktop", () => {
    expect(resolveImmersive(true, false)).toBe(true);
    expect(resolveImmersive(false, true)).toBe(false);
    expect(resolveImmersive(true, true)).toBe(true);
    expect(resolveImmersive(false, false)).toBe(false);
  });

  test("readImmersive returns true/false for the canonical strings", () => {
    expect(readImmersive(memoryStorage({ [IMMERSIVE_KEY]: "true" }))).toBe(true);
    expect(readImmersive(memoryStorage({ [IMMERSIVE_KEY]: "false" }))).toBe(false);
  });

  test("readImmersive returns null for missing or invalid stored values", () => {
    expect(readImmersive(memoryStorage())).toBeNull();
    expect(readImmersive(memoryStorage({ [IMMERSIVE_KEY]: "foo" }))).toBeNull();
    expect(readImmersive(memoryStorage({ [IMMERSIVE_KEY]: "1" }))).toBeNull();
    expect(readImmersive(memoryStorage({ [IMMERSIVE_KEY]: "" }))).toBeNull();
    expect(readImmersive(memoryStorage({ [IMMERSIVE_KEY]: "TRUE" }))).toBeNull();
  });

  test("writeImmersive round-trips through a mock storage", () => {
    const storage = memoryStorage();
    writeImmersive(storage, true);
    expect(storage.getItem(IMMERSIVE_KEY)).toBe("true");
    expect(readImmersive(storage)).toBe(true);

    writeImmersive(storage, false);
    expect(storage.getItem(IMMERSIVE_KEY)).toBe("false");
    expect(readImmersive(storage)).toBe(false);
  });

  test("hint-seen reads and writes independently of immersive", () => {
    const storage = memoryStorage();
    expect(readHintSeen(storage)).toBeNull();

    writeImmersive(storage, true);
    expect(readHintSeen(storage)).toBeNull();

    writeHintSeen(storage, true);
    expect(readHintSeen(storage)).toBe(true);
    expect(readImmersive(storage)).toBe(true);

    // Clearing hint-seen does not touch the immersive preference.
    writeHintSeen(storage, false);
    expect(readHintSeen(storage)).toBe(false);
    expect(readImmersive(storage)).toBe(true);
  });

  test("isPhoneMatch returns the matches field of the MediaQueryList", () => {
    expect(isPhoneMatch(new FakeMediaQueryList(true) as unknown as MediaQueryList)).toBe(true);
    expect(isPhoneMatch(new FakeMediaQueryList(false) as unknown as MediaQueryList)).toBe(false);
  });
});
