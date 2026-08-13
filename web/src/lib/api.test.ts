import { describe, expect, it } from "vitest";
import { csv, joinCSV } from "./utils";

describe("csv helpers", () => {
  it("splits and trims", () => {
    expect(csv("a, b, ,c")).toEqual(["a", "b", "c"]);
  });
  it("joins", () => {
    expect(joinCSV(["a", "b"])).toBe("a, b");
    expect(joinCSV(undefined)).toBe("");
  });
});
