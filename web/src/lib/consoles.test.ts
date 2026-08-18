import { describe, expect, it } from "vitest";
import { homeFor, visibleNav } from "./consoles";

describe("consoles", () => {
  it("sends each role to its own home", () => {
    expect(homeFor("super_admin")).toBe("/platform");
    expect(homeFor("enterprise_admin")).toBe("/enterprise");
    expect(homeFor("team_admin")).toBe("/team");
    expect(homeFor("developer")).toBe("/team");
  });

  it("hides provider and key routes from enterprise", () => {
    const labels = visibleNav("enterprise_admin").map((i) => i.to);
    expect(labels.some((t) => t.includes("providers"))).toBe(false);
    expect(labels.some((t) => t.includes("models"))).toBe(false);
    expect(labels.every((t) => !t.includes("/platform"))).toBe(true);
  });

  it("hides add-developer from developers", () => {
    expect(visibleNav("developer").some((i) => i.label === "加开发者")).toBe(false);
    expect(visibleNav("team_admin").some((i) => i.label === "加开发者")).toBe(true);
  });
});