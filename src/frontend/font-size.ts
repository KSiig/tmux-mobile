export const FONT_SIZE_KEY = "tmux-mobile-font-size";

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 14;

export const DEFAULT_PHONE_FONT_SIZE = 11;
export const DEFAULT_DESKTOP_FONT_SIZE = 14;

const isInRange = (value: number): boolean =>
  Number.isInteger(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE;

export const readFontSize = (storage: Pick<Storage, "getItem">): number | null => {
  const stored = storage.getItem(FONT_SIZE_KEY);
  if (stored === null) {
    return null;
  }
  const parsed = Number(stored);
  if (!Number.isFinite(parsed) || !isInRange(parsed)) {
    return null;
  }
  return parsed;
};

export const writeFontSize = (
  storage: Pick<Storage, "setItem">,
  size: number
): void => {
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  storage.setItem(FONT_SIZE_KEY, String(clamped));
};

export const resolveFontSize = (stored: number | null, isPhone: boolean): number => {
  if (stored !== null) {
    return stored;
  }
  return isPhone ? DEFAULT_PHONE_FONT_SIZE : DEFAULT_DESKTOP_FONT_SIZE;
};