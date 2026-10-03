/**
 * step-migration.test.ts
 * Id-based wizard step resolution — no version chain; idempotent normalize.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROSPECTING_WIZARD_STATE,
  loadProspectingWizardFromStorage,
  normalizeProspectingWizardState,
  PROSPECTING_STEPS,
  resolveCurrentStepId,
  saveProspectingWizardToStorage,
  type ProspectingStepDefinition,
  type ProspectingStepId,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

const COMPLETE_ICP = {
  icpTargetVerticals: "Multi-location dental and specialty clinics",
  icpSizeMinLocations: "3",
  icpSizeMaxLocations: "12",
  icpOperationalSignals: "Manual phone scheduling, rising no-shows, after-hours demand",
  icpDisqualifier1: "Single-location practices",
  icpDisqualifier2: "No front-desk overload signal",
  icpDisqualifier3: "Outside target metro territory",
} as const;

const FILLED_DATA: Partial<ProspectingWizardState> = {
  ...COMPLETE_ICP,
  shortlistedCompanyIds: ["a", "b", "c"],
  selectedLeadId: "lead-1",
  openingMessage: "A filled opening message with enough words for context.",
  onboardingComplete: true,
  agentDesign: "my agent",
  directoryCompanyIds: ["a", "b", "c"],
};

function baseDraft(
  overrides: Record<string, unknown> = {}
): Partial<ProspectingWizardState> & Record<string, unknown> {
  return {
    ...FILLED_DATA,
    currentStepId: "research",
    ...overrides,
  };
}

describe("resolveCurrentStepId / normalizeProspectingWizardState", () => {
  it("keeps a valid currentStepId", () => {
    for (const step of PROSPECTING_STEPS) {
      expect(resolveCurrentStepId({ currentStepId: step.id })).toBe(step.id);
      const normalized = normalizeProspectingWizardState(
        baseDraft({ currentStepId: step.id })
      );
      expect(normalized.currentStepId).toBe(step.id);
    }
  });

  it("falls back to the first step for unknown ids", () => {
    expect(resolveCurrentStepId({ currentStepId: "not_a_real_step" })).toBe(
      "onboarding"
    );
    const normalized = normalizeProspectingWizardState(
      baseDraft({ currentStepId: "ghost_step" })
    );
    expect(normalized.currentStepId).toBe("onboarding");
  });

  it("falls back to the first step for legacy numeric currentStep / any version", () => {
    const legacySamples = [
      { currentStep: 0, prospectingStepVersion: 1 },
      { currentStep: 2, prospectingStepVersion: 3 },
      { currentStep: 5, prospectingStepVersion: 5 },
      { currentStep: 4 },
      { prospectingStepVersion: 2 },
    ];
    for (const sample of legacySamples) {
      // No currentStepId — only legacy numeric / version fields plus filled data.
      const raw = { ...FILLED_DATA, ...sample };
      const normalized = normalizeProspectingWizardState(raw);
      expect(normalized.currentStepId, JSON.stringify(sample)).toBe("onboarding");
      // All other filled data preserved — reset changes only step position.
      expect(normalized.icpTargetVerticals).toBe(FILLED_DATA.icpTargetVerticals);
      expect(normalized.shortlistedCompanyIds).toEqual(FILLED_DATA.shortlistedCompanyIds);
      expect(normalized.selectedLeadId).toBe(FILLED_DATA.selectedLeadId);
      expect(normalized.openingMessage).toBe(FILLED_DATA.openingMessage);
      expect(normalized.onboardingComplete).toBe(true);
      expect(normalized.agentDesign).toBe(FILLED_DATA.agentDesign);
      expect(normalized).not.toHaveProperty("prospectingStepVersion");
      expect(normalized).not.toHaveProperty("currentStep");
    }
  });

  it("is idempotent: normalize(normalize(x)) equals normalize(x)", () => {
    const samples: Array<Record<string, unknown>> = [
      baseDraft({ currentStepId: "onboarding" }),
      baseDraft({ currentStepId: "opening" }),
      baseDraft({ currentStepId: "not_a_real_step" }),
      baseDraft({ currentStep: 3, prospectingStepVersion: 1 }),
      baseDraft({ currentStep: 5, prospectingStepVersion: 5 }),
      DEFAULT_PROSPECTING_WIZARD_STATE,
      { ...COMPLETE_ICP, currentStepId: "icp", onboardingComplete: true },
    ];
    for (const sample of samples) {
      const once = normalizeProspectingWizardState(sample);
      const twice = normalizeProspectingWizardState(once);
      expect(twice).toEqual(once);
    }
  });

  it("stage_data and localStorage load paths behave identically", () => {
    const raw = baseDraft({ currentStepId: "select_lead" });
    const fromStageData = normalizeProspectingWizardState(raw);

    const store = new Map<string, string>();
    const attemptId = "attempt-id-path";
    stubLocalStorage(store);
    store.set(`rehearse-prospecting-wizard-${attemptId}`, JSON.stringify(raw));
    const fromStorage = loadProspectingWizardFromStorage(attemptId);
    expect(fromStorage).toEqual(fromStageData);

    saveProspectingWizardToStorage(attemptId, fromStageData);
    expect(loadProspectingWizardFromStorage(attemptId)).toEqual(fromStageData);
  });

  it("keeps a saved id when an extra step is inserted into the step list", () => {
    const stepsWithExtra: readonly ProspectingStepDefinition[] = [
      PROSPECTING_STEPS[0]!,
      PROSPECTING_STEPS[1]!,
      {
        id: "research" as ProspectingStepId,
        label: "Data Room",
        description: "…",
      },
      {
        id: "bonus" as ProspectingStepId,
        label: "Bonus",
        description: "Inserted step",
      },
      ...PROSPECTING_STEPS.slice(3),
    ];
    // Saved id still points at research even though the list grew.
    expect(
      resolveCurrentStepId({ currentStepId: "research" }, stepsWithExtra)
    ).toBe("research");
    expect(
      resolveCurrentStepId({ currentStepId: "select_lead" }, stepsWithExtra)
    ).toBe("select_lead");
  });
});

function stubLocalStorage(store: Map<string, string>): void {
  const localStorage = {
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    get length(): number {
      return store.size;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { localStorage };
}
