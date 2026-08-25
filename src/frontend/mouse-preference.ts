export const MOUSE_PREFERENCE_KEY = "tmux-mobile-mouse";

export const readMousePreference = (storage: Pick<Storage, "getItem">): boolean | null => {
  const stored = storage.getItem(MOUSE_PREFERENCE_KEY);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return null;
};

export const writeMousePreference = (
  storage: Pick<Storage, "setItem">,
  enabled: boolean
): void => {
  storage.setItem(MOUSE_PREFERENCE_KEY, enabled ? "true" : "false");
};

export const resolveMouseEnabled = (stored: boolean | null, tmuxEnabled: boolean): boolean =>
  stored ?? tmuxEnabled;
