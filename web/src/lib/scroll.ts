// ZWUI-019: transcript scroll anchoring — loading earlier messages preserves
// the reading position instead of jumping to the bottom.
export function anchorScroll(container: HTMLElement, previousHeight: number) {
  const delta = container.scrollHeight - previousHeight;
  if (delta > 0) container.scrollTop += delta;
}
