import {
  fingerDeltaToWheelDeltaY,
  shouldEnterHistory,
  takeWheelTicks
} from "./history-gesture";

export interface TerminalGestureOptions {
  isMouseEnabled: () => boolean;
  isBlocked: () => boolean;
  onEnterHistory: () => void;
  onMouseWheel: (clientX: number, clientY: number, ticks: number) => void;
}

export const encodeSgrWheel = (ticks: number, col: number, row: number): string => {
  if (ticks === 0) {
    return "";
  }
  const button = ticks < 0 ? 64 : 65;
  const cell = `\x1b[<${button};${Math.max(1, col)};${Math.max(1, row)}M`;
  return cell.repeat(Math.abs(ticks));
};

export const cellFromPoint = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  cols: number,
  rows: number
): { col: number; row: number } => {
  const col = Math.min(
    Math.max(cols, 1),
    Math.max(1, Math.floor(((clientX - rect.left) / Math.max(rect.width, 1)) * cols) + 1)
  );
  const row = Math.min(
    Math.max(rows, 1),
    Math.max(1, Math.floor(((clientY - rect.top) / Math.max(rect.height, 1)) * rows) + 1)
  );
  return { col, row };
};

export const attachTerminalGestures = (
  host: HTMLElement,
  options: TerminalGestureOptions
): (() => void) => {
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let wheelAccum = 0;
  let tracking = false;
  let pointerId: number | null = null;
  let usedTouch = false;

  const reset = (): void => {
    tracking = false;
    pointerId = null;
    usedTouch = false;
    wheelAccum = 0;
  };

  const onMove = (clientX: number, clientY: number, event: Event): void => {
    if (!tracking || options.isBlocked()) {
      return;
    }

    const deltaX = clientX - startX;
    const deltaY = clientY - startY;
    if (options.isMouseEnabled()) {
      event.preventDefault();
      const step = clientY - lastY;
      lastY = clientY;
      wheelAccum += fingerDeltaToWheelDeltaY(step);
      const { ticks, remainder } = takeWheelTicks(wheelAccum);
      wheelAccum = remainder;
      if (ticks !== 0) {
        options.onMouseWheel(clientX, clientY, ticks);
      }
      return;
    }

    if (
      shouldEnterHistory({
        mouseEnabled: false,
        deltaX,
        deltaY
      })
    ) {
      event.preventDefault();
      options.onEnterHistory();
      reset();
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || options.isBlocked()) {
      return;
    }
    tracking = true;
    pointerId = event.pointerId;
    usedTouch = false;
    startX = event.clientX;
    startY = event.clientY;
    lastY = event.clientY;
    wheelAccum = 0;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!tracking || event.pointerId !== pointerId) {
      return;
    }
    onMove(event.clientX, event.clientY, event);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) {
      reset();
    }
  };

  const onTouchStart = (event: TouchEvent): void => {
    if (tracking && pointerId !== null) {
      return;
    }
    if (options.isBlocked() || event.touches.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    tracking = true;
    usedTouch = true;
    pointerId = null;
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    wheelAccum = 0;
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (!tracking || !usedTouch || event.touches.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    onMove(touch.clientX, touch.clientY, event);
  };

  const onTouchEnd = (): void => {
    if (usedTouch) {
      reset();
    }
  };

  host.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("touchstart", onTouchStart, { passive: false });
  host.addEventListener("touchmove", onTouchMove, { passive: false });
  host.addEventListener("touchend", onTouchEnd);
  host.addEventListener("touchcancel", onTouchEnd);

  return () => {
    host.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    host.removeEventListener("touchstart", onTouchStart);
    host.removeEventListener("touchmove", onTouchMove);
    host.removeEventListener("touchend", onTouchEnd);
    host.removeEventListener("touchcancel", onTouchEnd);
    reset();
  };
};
