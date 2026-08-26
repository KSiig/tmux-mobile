export const IMMERSIVE_KEY = "tmux-mobile-immersive";
export const HINT_SEEN_KEY = "tmux-mobile-immersive-hint-seen";

export const PHONE_MEDIA_QUERY = "(max-width: 768px), (pointer: coarse)";

export const readImmersive = (storage: Pick<Storage, "getItem">): boolean | null => {
  const stored = storage.getItem(IMMERSIVE_KEY);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return null;
};

export const writeImmersive = (
  storage: Pick<Storage, "setItem">,
  on: boolean
): void => {
  storage.setItem(IMMERSIVE_KEY, on ? "true" : "false");
};

export const resolveImmersive = (stored: boolean | null, _isPhone: boolean): boolean => {
  // Default OFF on phone and on desktop for this ticket. The stored value
  // always wins. SII-42 will flip the default to true when the user picks
  // the "Immersive" preset.
  if (stored !== null) {
    return stored;
  }
  return false;
};

export const readHintSeen = (storage: Pick<Storage, "getItem">): boolean | null => {
  const stored = storage.getItem(HINT_SEEN_KEY);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return null;
};

export const writeHintSeen = (
  storage: Pick<Storage, "setItem">,
  seen: boolean
): void => {
  storage.setItem(HINT_SEEN_KEY, seen ? "true" : "false");
};

export const isPhoneMatch = (mql: MediaQueryList): boolean => mql.matches;
