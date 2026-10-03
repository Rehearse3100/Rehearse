/**
 * step-migration.test.ts
 * Guards prospectingStepVersion → current step migration and idempotency.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROSPECTING_WIZARD_STATE,
  loadProspectingWizardFromStorage,
  normalizeProspectingWizardState,
  PROSPECTING_STEP_VERSION,
  saveProspectingWizardToStorage,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

/** ICP form that satisfies isIcpDefinitionComplete (avoids forced step reset). */
const COMPLETE_ICP = {
  icpTargetVerticals: "Multi-location dental and specialty clinics",
  icpSizeMinLocations: "3",
  icpSizeMaxLocations: "12",
  icpOperationalSignals: "Manual phone scheduling, rising no-shows, after-hours demand",
  icpDisqualifier1: "Single-location practices",
  icpDisqualifier2: "No front-desk overload signal",
  icpDisqualifier3: "Outside target metro territory",
} as const;

/**
 * Sibling stage_data.icp payload — parseProspectingIcpState requires result
 * affirmed/corrected before feedbackSeen counts as icpDone.
 */
const ICP_DONE = {
  result: "affirmed" as const,
  feedbackSeen: true,
  originalText: "dental multi-location",
  displayText: "dental multi-location",
  activeIcpText: "dental multi-location",
};

function baseDraft(
  overrides: Record<string, unknown> = {}
): Partial<ProspectingWizardState> & { icp?: { feedbackSeen: boolean } } {
  return {
    ...COMPLETE_ICP,
    selectedLeadId: null,
    shortlistedCompanyIds: [],
    directoryCompanyIds: [],
    openingMessage: "",
    agentDesign: "",
    agentCorrections: "",
    prospectingHandoffSeen: false,
    onboardingComplete: false,
    icp: ICP_DONE,
    ...overrides,
  };
}

/**
 * Expected CURRENT step after migrating a saved version + step with icpDone.
 * Chain: v1→v2 (+1 ICP), v2→v3 (+1 if step≥2 agent), v3→v4 (+1 onboarding), v4→v5 (noop).
 */
function expectedCurrentStep(savedVersion: number, savedStep: number): number {
  let step = savedStep;
  if (savedVersion < 2) {
    step = Math.min(step + 1, 5);
  }
  if (savedVersion < 3 && step >= 2) {
    step = Math.min(step + 1, 5);
  }
  if (savedVersion < 4) {
    step = Math.min(step + 1, 5);
  }
  return step;
}

/** Max valid step index that existed before each version's layout change. */
function maxStepForVersion(version: number): number {
  if (version <= 1) return 3; // research / lead / opening-ish layout before ICP+agent+onboarding
  if (version === 2) return 4; // after ICP insert, before agent
  if (version === 3) return 4; // after agent, before onboarding (0..4)
  return 5; // v4+ current 6-step indices 0..5
}

describe("normalizeProspectingWizardState — version → step mapping", () => {
  it("maps every saved prospectingStepVersion and step index to the correct current step", () => {
    for (let version = 1; version <= PROSPECTING_STEP_VERSION; version += 1) {
      const maxStep = maxStepForVersion(version);
      for (let step = 0; step <= maxStep; step += 1) {
        const normalized = normalizeProspectingWizardState(
          baseDraft({
            prospectingStepVersion: version,
            currentStep: step,
            onboardingComplete: version >= 4 ? step > 0 : false,
          })
        );
        expect(
          normalized.currentStep,
          `v${version} step ${step}`
        ).toBe(expectedCurrentStep(version, step));
      }
    }
  });

  it("marks pre-v4 migrations as onboardingComplete so they are not re-gated", () => {
    for (const version of [1, 2, 3]) {
      const normalized = normalizeProspectingWizardState(
        baseDraft({
          prospectingStepVersion: version,
          currentStep: 0,
          onboardingComplete: false,
        })
      );
      expect(normalized.onboardingComplete, `v${version}`).toBe(true);
      expect(normalized.prospectingStepVersion).toBe(PROSPECTING_STEP_VERSION);
    }
  });

  it("is idempotent: normalize(normalize(x)) equals normalize(x)", () => {
    const samples: Array<Partial<ProspectingWizardState> & { icp?: unknown }> = [
      baseDraft({ prospectingStepVersion: 1, currentStep: 0 }),
      baseDraft({ prospectingStepVersion: 1, currentStep: 2 }),
      baseDraft({ prospectingStepVersion: 2, currentStep: 1 }),
      baseDraft({ prospectingStepVersion: 2, currentStep: 3 }),
      baseDraft({ prospectingStepVersion: 3, currentStep: 2 }),
      baseDraft({ prospectingStepVersion: 4, currentStep: 0, onboardingComplete: true }),
      baseDraft({
        prospectingStepVersion: 5,
        currentStep: 4,
        onboardingComplete: true,
        selectedLeadId: "lead-1",
        shortlistedCompanyIds: ["a", "b", "c"],
      }),
      // Current-schema draft omitting version (must not be treated as v1)
      {
        ...COMPLETE_ICP,
        currentStep: 2,
        onboardingComplete: true,
        selectedLeadId: null,
        shortlistedCompanyIds: ["a", "b", "c"],
        icpTargetVerticals: COMPLETE_ICP.icpTargetVerticals,
      },
      DEFAULT_PROSPECTING_WIZARD_STATE,
    ];

    for (const sample of samples) {
      const once = normalizeProspectingWizardState(sample);
      const twice = normalizeProspectingWizardState(once);
      expect(twice, `idempotent after ${JSON.stringify({
        v: sample.prospectingStepVersion,
        s: sample.currentStep,
      })}`).toEqual(once);
    }
  });
});

describe("normalizeProspectingWizardState — load paths", () => {
  it("produces the same result for stage_data-shaped input and localStorage of the same raw draft", () => {
    const raw = baseDraft({
      prospectingStepVersion: 2,
      currentStep: 1,
      shortlistedCompanyIds: ["c1", "c2", "c3"],
    });

    const fromStageData = normalizeProspectingWizardState(raw);

    const store = new Map<string, string>();
    const attemptId = "attempt-migration-test";
    viStubLocalStorage(store);
    store.set(`rehearse-prospecting-wizard-${attemptId}`, JSON.stringify(raw));
    const fromStorage = loadProspectingWizardFromStorage(attemptId);

    expect(fromStorage).toEqual(fromStageData);
  });

  it("localStorage reload of an already-normalized state is idempotent", () => {
    const raw = baseDraft({
      prospectingStepVersion: 2,
      currentStep: 2,
      shortlistedCompanyIds: ["c1", "c2", "c3"],
    });
    const normalized = normalizeProspectingWizardState(raw);
    const store = new Map<string, string>();
    const attemptId = "attempt-migration-idempotent";
    viStubLocalStorage(store);
    saveProspectingWizardToStorage(attemptId, normalized);
    const reloaded = loadProspectingWizardFromStorage(attemptId);
    expect(reloaded).toEqual(normalized);
  });
});

/**
 * Minimal window.localStorage stub for Node vitest (load/save helpers need window).
 */
function viStubLocalStorage(store: Map<string, string>): void {
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
