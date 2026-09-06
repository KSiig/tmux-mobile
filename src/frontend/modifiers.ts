export type ModifierKey = "ctrl" | "alt" | "shift" | "meta";

export type ModifierMode = "off" | "sticky" | "locked";

export type ModifierMap = Record<ModifierKey, ModifierMode>;

export const MODIFIER_KEYS: readonly ModifierKey[] = ["ctrl", "alt", "shift", "meta"];

export const offModifiers = (): ModifierMap => ({
  ctrl: "off",
  alt: "off",
  shift: "off",
  meta: "off"
});

export const clearStickyModifiers = (modifiers: ModifierMap): ModifierMap => {
  const next: ModifierMap = { ...modifiers };
  for (const key of MODIFIER_KEYS) {
    if (next[key] === "sticky") {
      next[key] = "off";
    }
  }
  return next;
};

export interface ApplyModifiersResult {
  output: string;
  consumedSticky: boolean;
}

/**
 * Apply active modifiers to a terminal byte stream and report whether the
 * sticky modifier(s) should be consumed by this input.
 *
 * `consumedSticky` is only true when the input actually matched at least one
 * modifier transform. This prevents spurious events — empty strings, focus
 * noise from the IME (`\x1b[I`/`\x1b[O`), and similar — from clearing the
 * sticky modifier before the user types the real keypress.
 */
export const applyModifiers = (
  modifiers: ModifierMap,
  input: string
): ApplyModifiersResult => {
  let output = input;
  let consumedSticky = false;

  if (modifiers.shift !== "off" && output.length === 1 && /^[a-z]$/.test(output)) {
    output = output.toUpperCase();
    consumedSticky = true;
  }

  if (modifiers.ctrl !== "off" && output.length === 1) {
    output = String.fromCharCode(output.toUpperCase().charCodeAt(0) & 31);
    consumedSticky = true;
  }

  if (input.length >= 1 && (modifiers.alt !== "off" || modifiers.meta !== "off")) {
    output = `\u001b${output}`;
    consumedSticky = true;
  }

  return { output, consumedSticky };
};
