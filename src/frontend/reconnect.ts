export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_MAX_DELAY_MS = 10_000;

export interface ReconnectDecisionInput {
  closeCode?: number;
  socketGeneration: number;
  currentGeneration: number;
  unmounted: boolean;
  needsPassword: boolean;
  hasToken: boolean;
  authFailed: boolean;
}

export const shouldReconnect = (input: ReconnectDecisionInput): boolean => {
  if (input.unmounted) {
    return false;
  }
  if (!input.hasToken) {
    return false;
  }
  if (input.needsPassword) {
    return false;
  }
  if (input.authFailed) {
    return false;
  }
  if (input.socketGeneration !== input.currentGeneration) {
    return false;
  }
  if (input.closeCode === 4001) {
    return false;
  }
  return true;
};

export const reconnectDelayMs = (attempt: number, immediate: boolean): number => {
  if (immediate) {
    return 0;
  }
  const delay = RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt);
  return Math.min(RECONNECT_MAX_DELAY_MS, delay);
};

export const socketsNeedReconnect = (
  controlReadyState: number | undefined,
  terminalReadyState: number | undefined
): boolean => {
  const OPEN = 1;
  return controlReadyState !== OPEN || terminalReadyState !== OPEN;
};
