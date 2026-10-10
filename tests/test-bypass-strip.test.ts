/**
 * test-bypass-strip.test.ts
 * When bypass is off, strip helpers must clear [TEST] autofill leftovers.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiscoveryPrepAutofill,
  applyNegotiationAutofill,
  applyPresentationAutofill,
  isTestBypassAutofillValue,
  stripDiscoveryPrepTestAutofill,
  stripNegotiationTestAutofill,
  stripPresentationTestAutofill,
  stripTestBypassRecord,
  stripTestBypassString,
  stripWizardTestAutofill,
  TEST_BYPASS_PREFIX,
} from "@/lib/tempo-test-bypass-client";
import { createInitialNegotiationData } from "@/lib/tempo-negotiation";
import { DEFAULT_PROSPECTING_WIZARD_STATE } from "@/lib/tempo-prospecting";
import { EMPTY_PRESENTATION_FORM } from "@/lib/tempo-presentation";

describe("stripTestBypassString", () => {
  it("clears [TEST]-prefixed values", () => {
    expect(stripTestBypassString(`${TEST_BYPASS_PREFIX} hello`)).toBe("");
    expect(isTestBypassAutofillValue(`  ${TEST_BYPASS_PREFIX} x`)).toBe(true);
  });

  it("keeps real student text", () => {
    expect(stripTestBypassString("Multi-location dental")).toBe("Multi-location dental");
  });
});

describe("stripWizardTestAutofill", () => {
  it("clears [TEST] text and paired size defaults", () => {
    const filled = {
      ...DEFAULT_PROSPECTING_WIZARD_STATE,
      icpTargetVerticals: `${TEST_BYPASS_PREFIX} clinics`,
      icpDecisionMakerRole: `${TEST_BYPASS_PREFIX} ops`,
      icpSizeMinLocations: "5",
      icpSizeMaxLocations: "20",
      openingMessage: `${TEST_BYPASS_PREFIX} Hi Dana`,
    };
    const stripped = stripWizardTestAutofill(filled);
    expect(stripped.icpTargetVerticals).toBe("");
    expect(stripped.icpDecisionMakerRole).toBe("");
    expect(stripped.icpSizeMinLocations).toBe("");
    expect(stripped.icpSizeMaxLocations).toBe("");
    expect(stripped.openingMessage).toBe("");
  });

  it("does not clear size fields when no [TEST] markers exist", () => {
    const student = {
      ...DEFAULT_PROSPECTING_WIZARD_STATE,
      icpTargetVerticals: "Dental clinics",
      icpSizeMinLocations: "5",
      icpSizeMaxLocations: "20",
    };
    const stripped = stripWizardTestAutofill(student);
    expect(stripped.icpSizeMinLocations).toBe("5");
    expect(stripped.icpSizeMaxLocations).toBe("20");
    expect(stripped.icpTargetVerticals).toBe("Dental clinics");
  });
});

describe("strip stage autofill", () => {
  it("clears Discovery prep autofill", () => {
    const filled = applyDiscoveryPrepAutofill({
      openQuestions: ["", "", ""],
      anticipatedProbe: "",
      anticipatedConfirm: "",
    });
    const stripped = stripDiscoveryPrepTestAutofill(filled);
    expect(stripped.openQuestions.every((q) => q === "")).toBe(true);
    expect(stripped.anticipatedProbe).toBe("");
    expect(stripped.anticipatedConfirm).toBe("");
  });

  it("clears Presentation autofill", () => {
    const filled = applyPresentationAutofill(EMPTY_PRESENTATION_FORM);
    const stripped = stripPresentationTestAutofill(filled);
    expect(Object.values(stripped).every((v) => v === "")).toBe(true);
  });

  it("clears Negotiation AI-work autofill only", () => {
    const filled = applyNegotiationAutofill(createInitialNegotiationData());
    const stripped = stripNegotiationTestAutofill(filled);
    expect(stripped.aiWork.prompts).toBe("");
    expect(stripped.aiWork.corrections).toBe("");
    expect(stripped.scenarioAState).toBe("complete");
  });

  it("clears CRM field records", () => {
    expect(
      stripTestBypassRecord({
        accountName: `${TEST_BYPASS_PREFIX} Summit`,
        industry: "Healthcare",
      })
    ).toEqual({ accountName: "", industry: "Healthcare" });
  });
});
