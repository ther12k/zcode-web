// ZWUI-057: the inspector column is a fixed-width grid track, so an unclamped
// panel width wider than its row silently pushes the inspector off-screen
// (the shell clips overflow). Clamp the APPLIED width against the measured
// row; the stored preference stays raw so re-widening the window restores
// the user's chosen width, exactly like the reference frame's
// `clamp(rightWidth, 320, rightMax)`.
export const PANEL_MIN = 280;
export const PANEL_MAX = 900;
export const PANEL_DEFAULT = 420;
// the chat track's CSS floor (minmax(300px,1fr)) plus divider slack
const CHAT_FLOOR = 300;
const RESIZER_SLACK = 8;

/** Applied panel width for a stored preference and the measured row width.
 *  `mainWidth <= 0` (not yet measured) applies the preference unclamped.
 *  Below the panel column's own band the value is never consumed by CSS. */
export function effectivePanelWidth(stored: number | null, mainWidth: number): number {
  const preferred = Math.min(PANEL_MAX, Math.max(PANEL_MIN, stored ?? PANEL_DEFAULT));
  if (mainWidth <= 0) return preferred;
  return Math.min(preferred, Math.max(PANEL_MIN, Math.round(mainWidth) - CHAT_FLOOR - RESIZER_SLACK));
}
