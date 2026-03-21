export const MIN_USER_MESSAGE_TOP_OFFSET_PX = 24;
export const MAX_USER_MESSAGE_TOP_OFFSET_PX = 72;
export const USER_MESSAGE_TOP_OFFSET_VH = 0.08;
export const MIN_BOTTOM_SLACK_PX = 80;
export const BOTTOM_SLACK_VH = 0.12;

export function getUserMessageTopOffsetPx(viewportHeight: number): number {
  const viewportOffset = viewportHeight * USER_MESSAGE_TOP_OFFSET_VH;
  return Math.max(MIN_USER_MESSAGE_TOP_OFFSET_PX, Math.min(MAX_USER_MESSAGE_TOP_OFFSET_PX, viewportOffset));
}

export function getBottomSlackPx(viewportHeight: number): number {
  return Math.max(MIN_BOTTOM_SLACK_PX, viewportHeight * BOTTOM_SLACK_VH);
}
