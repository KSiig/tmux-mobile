import { describe, expect, test } from "vitest";
import {
  applyModifiers,
  clearStickyModifiers,
  MODIFIER_KEYS,
  offModifiers,
  type ModifierKey,
  type ModifierMap,
  type ModifierMode
} from "../../src/frontend/modifiers.js";

const withMode = (
  mode: ModifierMode,
  active: readonly ModifierKey[]
): ModifierMap => {
  const result = offModifiers();
  for (const key of active) {
    result[key] = mode;
  }
  return result;
};

describe("applyModifiers", () => {
  test("returns the input unchanged when no modifier is active", () => {
    const result = applyModifiers(offModifiers(), "a");
    expect(result.output).toBe("a");
    expect(result.consumedSticky).toBe(false);
  });

  test("empty input never consumes the sticky modifier", () => {
    for (const key of MODIFIER_KEYS) {
      const result = applyModifiers(withMode("sticky", [key]), "");
      expect(result.output).toBe("");
      expect(result.consumedSticky).toBe(false);
    }
  });

  test("IME noise (focus/blur event bytes) never consumes sticky for any modifier", () => {
    // xterm.js emits "\u001b[I" and "\u001b[O" via coreService.triggerDataEvent
    // when DEC 1004 (sendFocus) is enabled. These must never consume the
    // sticky modifier, and Alt/Meta must not double-prefix them with another
    // ESC byte.
    const focusEvent = "\u001b[I";
    const blurEvent = "\u001b[O";
    for (const key of MODIFIER_KEYS) {
      for (const noise of [focusEvent, blurEvent]) {
        const result = applyModifiers(withMode("sticky", [key]), noise);
        expect(result.output).toBe(noise);
        expect(result.consumedSticky).toBe(false);
      }
    }
  });

  test("active Ctrl + single letter produces a control byte and consumes sticky", () => {
    const result = applyModifiers(withMode("sticky", ["ctrl"]), "a");
    expect(result.output).toBe("\u0001");
    expect(result.consumedSticky).toBe(true);
  });

  test("active Ctrl + every lowercase letter produces the matching control byte", () => {
    for (let code = 0; code < 26; code++) {
      const letter = String.fromCharCode("a".charCodeAt(0) + code);
      const result = applyModifiers(withMode("sticky", ["ctrl"]), letter);
      expect(result.output).toBe(String.fromCharCode(code + 1));
      expect(result.consumedSticky).toBe(true);
    }
  });

  test("active Ctrl + uppercase letter produces the same control byte as lowercase", () => {
    expect(applyModifiers(withMode("sticky", ["ctrl"]), "A").output).toBe("\u0001");
    expect(applyModifiers(withMode("sticky", ["ctrl"]), "Z").output).toBe("\u001a");
  });

  test("active Ctrl + digit produces the matching control byte", () => {
    // Ctrl+5 is NAK (\x15). The byte is `charCodeAt & 0x1f`.
    const result = applyModifiers(withMode("sticky", ["ctrl"]), "5");
    expect(result.output).toBe("\u0015");
    expect(result.consumedSticky).toBe(true);
  });

  test("active Shift + lowercase letter uppercases and consumes sticky", () => {
    const result = applyModifiers(withMode("sticky", ["shift"]), "a");
    expect(result.output).toBe("A");
    expect(result.consumedSticky).toBe(true);
  });

  test("active Shift + uppercase letter passes through; sticky NOT consumed (new behaviour)", () => {
    // Documented in VEL-2009. The Shift regex is /^[a-z]$/, so an already-
    // uppercase letter is not transformed. Old behaviour consumed the sticky
    // on any single character; new behaviour only consumes on a real
    // transformation. User can then type a lowercase letter and still get
    // the uppercase transform.
    const result = applyModifiers(withMode("sticky", ["shift"]), "Z");
    expect(result.output).toBe("Z");
    expect(result.consumedSticky).toBe(false);
  });

  test("active Shift + digit does NOT consume the sticky (new behaviour)", () => {
    // Documented in VEL-2009. The user can toggle Shift, type a digit, then
    // type a letter and still get the uppercase transform. Old behaviour
    // consumed the sticky on any keypress; new behaviour only consumes when
    // a transform was actually applied.
    const result = applyModifiers(withMode("sticky", ["shift"]), "1");
    expect(result.output).toBe("1");
    expect(result.consumedSticky).toBe(false);
  });

  test("active Alt + single letter prefixes ESC and consumes sticky", () => {
    const result = applyModifiers(withMode("sticky", ["alt"]), "a");
    expect(result.output).toBe("\u001ba");
    expect(result.consumedSticky).toBe(true);
  });

  test("active Meta + single letter prefixes ESC and consumes sticky", () => {
    const result = applyModifiers(withMode("sticky", ["meta"]), "x");
    expect(result.output).toBe("\u001bx");
    expect(result.consumedSticky).toBe(true);
  });

  test("Alt + multi-character input still prefixes ESC and consumes sticky", () => {
    const result = applyModifiers(withMode("sticky", ["alt"]), "abc");
    expect(result.output).toBe("\u001babc");
    expect(result.consumedSticky).toBe(true);
  });

  test("Ctrl + Shift active together: ctrl byte wins for letters, sticky consumed", () => {
    const result = applyModifiers(withMode("sticky", ["ctrl", "shift"]), "a");
    // Shift would uppercase to A, then Ctrl takes & 0x1f → still \u0001.
    expect(result.output).toBe("\u0001");
    expect(result.consumedSticky).toBe(true);
  });

  test("Ctrl + Shift active together on a non-letter: Ctrl still fires", () => {
    // Shift branch doesn't match (not /^[a-z]$/), Ctrl branch does (length === 1).
    // "1" & 0x1f = 0x11 (DC1).
    const result = applyModifiers(withMode("sticky", ["ctrl", "shift"]), "1");
    expect(result.output).toBe("\u0011");
    expect(result.consumedSticky).toBe(true);
  });

  test("active Ctrl + empty string does not consume sticky", () => {
    const result = applyModifiers(withMode("sticky", ["ctrl"]), "");
    expect(result.output).toBe("");
    expect(result.consumedSticky).toBe(false);
  });

  test("locked modifiers behave identically to sticky for transformation purposes", () => {
    // Locked modifiers transform the same way as sticky. The pure helper is
    // intentionally modifier-mode agnostic — the App is responsible for not
    // clearing locked entries based on the consumedSticky flag.
    const result = applyModifiers(withMode("locked", ["ctrl"]), "a");
    expect(result.output).toBe("\u0001");
    expect(result.consumedSticky).toBe(true);
  });
});

describe("clearStickyModifiers", () => {
  test("returns offModifiers when given offModifiers", () => {
    expect(clearStickyModifiers(offModifiers())).toEqual(offModifiers());
  });

  test("returns offModifiers when given all sticky", () => {
    expect(clearStickyModifiers(withMode("sticky", ["ctrl", "alt", "shift", "meta"])))
      .toEqual(offModifiers());
  });

  test("leaves locked modifiers alone", () => {
    expect(clearStickyModifiers(withMode("locked", ["ctrl", "alt", "shift", "meta"])))
      .toEqual(withMode("locked", ["ctrl", "alt", "shift", "meta"]));
  });

  test("only clears sticky entries, preserves locked and off entries", () => {
    const input: ModifierMap = {
      ctrl: "sticky",
      alt: "locked",
      shift: "off",
      meta: "sticky"
    };
    expect(clearStickyModifiers(input)).toEqual({
      ctrl: "off",
      alt: "locked",
      shift: "off",
      meta: "off"
    });
  });

  test("returns a new map object (does not mutate the input)", () => {
    const input = withMode("sticky", ["ctrl", "alt", "shift", "meta"]);
    const result = clearStickyModifiers(input);
    expect(result).not.toBe(input);
    expect(input.ctrl).toBe("sticky");
  });
});

describe("offModifiers", () => {
  test("returns a map with every key set to off", () => {
    const result = offModifiers();
    for (const key of MODIFIER_KEYS) {
      expect(result[key]).toBe<ModifierMode>("off");
    }
  });
});
