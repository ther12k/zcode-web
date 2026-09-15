import { describe, expect, it } from "vitest";
import { effectivePanelWidth, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN } from "../layout";

describe("effectivePanelWidth (ZWUI-057)", () => {
  it("returns the responsive default when nothing is stored", () => {
    expect(effectivePanelWidth(null, 1346)).toBe(PANEL_DEFAULT);
  });

  it("returns the stored preference when the row has room", () => {
    expect(effectivePanelWidth(560, 1346)).toBe(560);
  });

  it("clamps a wide stored panel so the chat keeps its 300px floor", () => {
    // 900px viewport with the 60px icon rail leaves a 840px row
    expect(effectivePanelWidth(900, 840)).toBe(840 - 300 - 8); // 532
    expect(effectivePanelWidth(900, 761)).toBe(761 - 300 - 8); // narrowest shared-band row
  });

  it("never clamps below the drag minimum", () => {
    expect(effectivePanelWidth(420, 400)).toBe(PANEL_MIN);
  });

  it("bounds an out-of-range stored value", () => {
    expect(effectivePanelWidth(5000, 1346)).toBe(PANEL_MAX);
    expect(effectivePanelWidth(50, 1346)).toBe(PANEL_MIN);
  });

  it("applies the preference unclamped before the row is measured", () => {
    expect(effectivePanelWidth(900, 0)).toBe(900);
    expect(effectivePanelWidth(null, 0)).toBe(PANEL_DEFAULT);
  });
});
