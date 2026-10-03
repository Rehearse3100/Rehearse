/**
 * gates.test.ts
 * Locks canAdvanceProspectingStep conditions — including test-bypass short-circuit.
 */

import { describe, expect, it } from "vitest";
import {
  canAdvanceProspectingStep,
  DEFAULT_PROSPECTING_WIZARD_STATE,
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

describe("canAdvanceProspectingStep", () => {
  it("step 0 (onboarding): blocks until onboardingComplete", () => {
    expect(canAdvanceProspectingStep(0, withState({ onboardingComplete: false }))).toBe(
      false
    );
    expect(canAdvanceProspectingStep(0, withState({ onboardingComplete: true }))).toBe(
      true
    );
  });

  it("step 1 (ICP): blocks until ICP definition is complete", () => {
    expect(canAdvanceProspectingStep(1, withState({}))).toBe(false);
    expect(canAdvanceProspectingStep(1, withState(COMPLETE_ICP))).toBe(true);
  });

  it("step 2 (Data Room): requires exactly three shortlisted companies", () => {
    expect(
      canAdvanceProspectingStep(2, withState({ shortlistedCompanyIds: ["a", "b"] }))
    ).toBe(false);
    expect(
      canAdvanceProspectingStep(
        2,
        withState({ shortlistedCompanyIds: ["a", "b", "c", "d"] })
      )
    ).toBe(false);
    expect(
      canAdvanceProspectingStep(2, withState({ shortlistedCompanyIds: ["a", "b", "c"] }))
    ).toBe(true);
  });

  it("step 3 (Agent): always passes", () => {
    expect(canAdvanceProspectingStep(3, withState({}))).toBe(true);
  });

  it("step 4 (Select Lead): requires selectedLeadId", () => {
    expect(canAdvanceProspectingStep(4, withState({ selectedLeadId: null }))).toBe(
      false
    );
    expect(canAdvanceProspectingStep(4, withState({ selectedLeadId: "lead-1" }))).toBe(
      true
    );
  });

  it("step 5 (Opening): requires 20–120 words", () => {
    expect(canAdvanceProspectingStep(5, withState({ openingMessage: "Too short" }))).toBe(
      false
    );
    expect(
      canAdvanceProspectingStep(5, withState({ openingMessage: OPENING_OK }))
    ).toBe(true);
  });

  it("unknown step index blocks", () => {
    expect(canAdvanceProspectingStep(99, withState({}))).toBe(false);
  });

  it("testBypass true: every step passes", () => {
    const empty = withState({});
    for (const step of [0, 1, 2, 3, 4, 5]) {
      expect(canAdvanceProspectingStep(step, empty, true)).toBe(true);
    }
  });

  it("testBypass false or omitted: identical to normal gating", () => {
    const unmet = withState({});
    const metOnboarding = withState({ onboardingComplete: true });
    expect(canAdvanceProspectingStep(0, unmet, false)).toBe(
      canAdvanceProspectingStep(0, unmet)
    );
    expect(canAdvanceProspectingStep(0, metOnboarding, false)).toBe(
      canAdvanceProspectingStep(0, metOnboarding)
    );
    expect(canAdvanceProspectingStep(1, unmet, false)).toBe(false);
    expect(canAdvanceProspectingStep(2, unmet, false)).toBe(false);
    expect(canAdvanceProspectingStep(4, unmet, false)).toBe(false);
    expect(canAdvanceProspectingStep(5, unmet, false)).toBe(false);
  });
});
