/**
 * test-bypass.test.ts
 * isGateBypassEnabled must accept only the exact string "true".
 */

import { afterEach, describe, expect, it } from "vitest";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";

const ENV_KEY = "TEMPO_TEST_BYPASS_GATES";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("isGateBypassEnabled", () => {
  it('returns true only for the exact string "true"', () => {
    process.env[ENV_KEY] = "true";
    expect(isGateBypassEnabled()).toBe(true);
  });

  it.each([
    ["false", "false"],
    ["empty string", ""],
    ["TRUE", "TRUE"],
    ["1", "1"],
    ["yes", "yes"],
    ["undefined", undefined],
  ] as const)("returns false for %s", (_label, value) => {
    if (value === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = value;
    }
    expect(isGateBypassEnabled()).toBe(false);
  });
});
