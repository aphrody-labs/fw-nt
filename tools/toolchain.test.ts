import { expect, test } from "bun:test";
import { cmp, firstVersion } from "./toolchain.ts";

test("cmp orders dotted versions numerically", () => {
  expect(cmp("14.52.37025", "14.50")).toBeGreaterThan(0);
  expect(cmp("10.0.26100.0", "10.0.28000.0")).toBeLessThan(0);
  expect(cmp("1.100.0", "1.95.0")).toBeGreaterThan(0);
  expect(cmp("11.0", "11.0.0")).toBe(0);
});

test("firstVersion extracts the version from tool output", () => {
  expect(firstVersion("rustc 1.100.0 (0ef1bc386 2026-11-09)")).toBe("1.100.0");
  expect(firstVersion("cmake version 4.4.4")).toBe("4.4.4");
  expect(firstVersion("1.13.2.git.kitware.jobserver-pipe-1")).toBe("1.13.2");
  expect(firstVersion("no digits")).toBeUndefined();
});
