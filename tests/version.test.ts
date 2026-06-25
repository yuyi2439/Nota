import { expect, test } from "vitest";
import pkg from "../package.json";
import { VERSION } from "../src/version";

test("Assert version", () => {
  expect(VERSION).toBe(pkg.version);
});
