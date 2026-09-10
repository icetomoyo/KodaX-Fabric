export const TOKEN_BOT_POSITION_KEY = "token-bot-position";
export const TOKEN_BOT_DRAG_THRESHOLD = 5;
export const TOKEN_BOT_VIEW_MARGIN = 8;

export type TokenBotPosition = {
  right: number;
  bottom: number;
};

export function parseTokenBotPosition(raw: string | null | undefined): TokenBotPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { right?: unknown; bottom?: unknown };
    if (typeof value.right !== "number" || typeof value.bottom !== "number") return null;
    if (!Number.isFinite(value.right) || !Number.isFinite(value.bottom)) return null;
    return { right: value.right, bottom: value.bottom };
  } catch {
    return null;
  }
}

export function clampTokenBotPosition(input: {
  right: number;
  bottom: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}): TokenBotPosition {
  const margin = input.margin ?? TOKEN_BOT_VIEW_MARGIN;
  const maxRight = Math.max(margin, input.viewportWidth - input.width - margin);
  const maxBottom = Math.max(margin, input.viewportHeight - input.height - margin);
  return {
    right: Math.min(maxRight, Math.max(margin, input.right)),
    bottom: Math.min(maxBottom, Math.max(margin, input.bottom)),
  };
}

export function moveTokenBotPosition(
  origin: TokenBotPosition,
  dx: number,
  dy: number,
  size: {
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  },
): TokenBotPosition {
  return clampTokenBotPosition({
    right: origin.right - dx,
    bottom: origin.bottom - dy,
    ...size,
  });
}

export function tokenBotDragMoved(
  dx: number,
  dy: number,
  threshold = TOKEN_BOT_DRAG_THRESHOLD,
): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

export function boxToRightBottom(box: {
  right: number;
  bottom: number;
  viewportWidth: number;
  viewportHeight: number;
}): TokenBotPosition {
  return {
    right: box.viewportWidth - box.right,
    bottom: box.viewportHeight - box.bottom,
  };
}
