/**
 * gates.test.ts
 * Locks canAdvanceProspectingStep conditions — including test-bypass short-circuit.
 * Signature is id-keyed; each gate's condition is unchanged from the index era.
 */

import { describe, expect, it } from "vitest";
import {
  canAdvanceProspectingStep,
  DEFAULT_PROSPECTING_WIZARD_STATE,
  type ProspectingStepId,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

function withState(
  overrides: Partial<ProspectingWizardState>
): ProspectingWizardState {
  return { ...DEFAULT_PROSPECTING_WIZARD_STATE, ...overrides };
}

const COMPLETE_ICP: Partial<ProspectingWizardState> = {
  icpTargetVerticals: "Multi-location dental and specialty clinics",
  icpSizeMinLocations: "3",
  icpSizeMaxLocations: "12",
  icpOperationalSignals: "Manual phone scheduling, rising no-shows, after-hours demand",
  icpDisqualifier1: "Single-location practices",
  icpDisqualifier2: "No front-desk overload signal",
  icpDisqualifier3: "Outside target metro territory",
};

const OPENING_OK =
  "Hi Dana — I noticed Summit Dental Group opened an eighth location and wanted " +
  "to reach out about how Tempo helps multi-site dental groups reduce no-shows " +
  "and capture after-hours demand for operations teams.";

const ALL_STEPS: ProspectingStepId[] = [
  "onboarding",
  "icp",
  "research",
  "agent",
  "select_lead",
  "opening",
];

describe("canAdvanceProspectingStep", () => {
  it("onboarding: blocks until onboardingComplete", () => {
    expect(
      canAdvanceProspectingStep("onboarding", withState({ onboardingComplete: false }))
    ).toBe(false);
    expect(
      canAdvanceProspectingStep("onboarding", withState({ onboardingComplete: true }))
    ).toBe(true);
  });

  it("icp: blocks until ICP definition is complete", () => {
    expect(canAdvanceProspectingStep("icp", withState({}))).toBe(false);
    expect(canAdvanceProspectingStep("icp", withState(COMPLETE_ICP))).toBe(true);
  });

  it("research: requires exactly three shortlisted companies", () => {
    expect(
      canAdvanceProspectingStep(
        "research",
        withState({ shortlistedCompanyIds: ["a", "b"] })
      )
    ).toBe(false);
    expect(
      canAdvanceProspectingStep(
        "research",
        withState({ shortlistedCompanyIds: ["a", "b", "c", "d"] })
      )
    ).toBe(false);
    expect(
      canAdvanceProspectingStep(
        "research",
        withState({ shortlistedCompanyIds: ["a", "b", "c"] })
      )
    ).toBe(true);
  });

  it("agent: always passes", () => {
    expect(canAdvanceProspectingStep("agent", withState({}))).toBe(true);
  });

  it("select_lead: requires selectedLeadId", () => {
    expect(
      canAdvanceProspectingStep("select_lead", withState({ selectedLeadId: null }))
    ).toBe(false);
    expect(
      canAdvanceProspectingStep("select_lead", withState({ selectedLeadId: "lead-1" }))
    ).toBe(true);
  });

  it("opening: requires 20–120 words", () => {
    expect(
      canAdvanceProspectingStep("opening", withState({ openingMessage: "Too short" }))
    ).toBe(false);
    expect(
      canAdvanceProspectingStep("opening", withState({ openingMessage: OPENING_OK }))
    ).toBe(true);
  });

  it("unknown step id blocks", () => {
    expect(canAdvanceProspectingStep("not_a_step", withState({}))).toBe(false);
  });

  it("testBypass true: every step passes", () => {
    const empty = withState({});
    for (const step of ALL_STEPS) {
      expect(canAdvanceProspectingStep(step, empty, true)).toBe(true);
    }
  });

  it("testBypass false or omitted: identical to normal gating", () => {
    const unmet = withState({});
    const metOnboarding = withState({ onboardingComplete: true });
    expect(canAdvanceProspectingStep("onboarding", unmet, false)).toBe(
      canAdvanceProspectingStep("onboarding", unmet)
    );
    expect(canAdvanceProspectingStep("onboarding", metOnboarding, false)).toBe(
      canAdvanceProspectingStep("onboarding", metOnboarding)
    );
    expect(canAdvanceProspectingStep("icp", unmet, false)).toBe(false);
    expect(canAdvanceProspectingStep("research", unmet, false)).toBe(false);
    expect(canAdvanceProspectingStep("select_lead", unmet, false)).toBe(false);
    expect(canAdvanceProspectingStep("opening", unmet, false)).toBe(false);
  });
});
