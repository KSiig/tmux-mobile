export const HISTORY_SWIPE_THRESHOLD_PX = 48;
export const HISTORY_TAP_SLOP_PX = 12;

export const shouldEnterHistory = (input: {
  mouseEnabled: boolean;
  deltaX: number;
  deltaY: number;
}): boolean => {
  if (input.mouseEnabled) {
    return false;
  }
  return (
    input.deltaY <= -HISTORY_SWIPE_THRESHOLD_PX &&
    Math.abs(input.deltaY) >= Math.abs(input.deltaX) * 1.5
  );
};

export const shouldExitHistory = (input: {
  atLatest: boolean;
  deltaX: number;
  deltaY: number;
  totalMovePx: number;
}): boolean => {
  if (input.totalMovePx <= HISTORY_TAP_SLOP_PX) {
    return true;
  }
  return (
    input.atLatest &&
    input.deltaY >= HISTORY_SWIPE_THRESHOLD_PX &&
    Math.abs(input.deltaY) >= Math.abs(input.deltaX) * 1.5
  );
};

export const isScrolledToLatest = (element: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean => element.scrollTop + element.clientHeight >= element.scrollHeight - 2;

export const scrollElementToLatest = (element: { scrollHeight: number; scrollTop: number }): void => {
  element.scrollTop = element.scrollHeight;
};
