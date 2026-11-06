/**
 * prospecting-wizard-hook.test.ts
 * Regression for "Submit on Build Your Agent never enables" (tester mode off):
 * Next on Select Target Lead saves the picked lead and then advances in the same
 * click, using the hook object from the render before the save. Advancing must
 * build on the latest state, or it writes back the old copy and erases the lead.
 * React's hooks are replaced by a minimal synchronous stand-in so the hook can run
 * in node exactly as one component render would; fetch is mocked (no network).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProspectingWizard } from "@/hooks/useProspectingWizard";
import {
  advanceWizardStep,
  canSubmitProspectingBrief,
  DEFAULT_PROSPECTING_WIZARD_STATE,
  firstIncompleteProspectingStep,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

// ── A one-component stand-in for React's hooks ───

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = hooks.index++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      const set = (update: unknown): void => {
        hooks.values[slot] = typeof update === "function" ? (update as (prev: unknown) => unknown)(hooks.values[slot]) : update;
      };
      return [hooks.values[slot], set];
    },
    useCallback: (fn: unknown) => fn,
    useEffect: () => undefined,
    useRef: (current: unknown) => ({ current }),
  };
});

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
  async () => new Response(JSON.stringify({}), { status: 200 })
);

/** Renders the hook once; the wizard state is its first useState slot. */
function renderOnce(initial: ProspectingWizardState): ReturnType<typeof useProspectingWizard> {
  hooks.index = 0;
  hooks.values = [initial];
  return useProspectingWizard({ attemptId: "attempt-1" });
}

const wizardState = (): ProspectingWizardState => hooks.values[0] as ProspectingWizardState;

/** Everything done up to Select Target Lead, with no lead picked yet. */
const READY_TO_PICK: ProspectingWizardState = {
  ...DEFAULT_PROSPECTING_WIZARD_STATE,
  currentStepId: "select_lead",
  onboardingComplete: true,
  icpTargetVerticals: "Multi-location dental groups",
  icpDecisionMakerRole: "Director of Operations",
  icpSizeMinLocations: "3",
  icpSizeMaxLocations: "12",
  icpOperationalSignals: "Phone scheduling and a new location",
  icpDisqualifier1: "Locked into a vendor",
  icpDisqualifier2: "Spending freeze",
  shortlistedCompanyIds: ["dir-1", "dir-2", "dir-3"],
  selectedLeadId: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

describe("Select Target Lead → Next", () => {
  it("keeps the picked lead when advancing with the same render's hook (the old code erased it)", async () => {
    const wizard = renderOnce(READY_TO_PICK);
    await wizard.completeLeadSelection("lead-9");
    await wizard.handleStepAdvance("opening");
    expect(wizardState()).toMatchObject({ currentStepId: "opening", selectedLeadId: "lead-9" });

    // The step change saved to the server carries the lead too.
    const calls = fetchMock.mock.calls;
    const lastSave = JSON.parse(String(calls[calls.length - 1]?.[1]?.body ?? "{}")) as { state?: unknown };
    expect(lastSave.state).toMatchObject({ currentStepId: "opening", selectedLeadId: "lead-9" });
  });

  it("so Submit enables once the opening and agent are done", async () => {
    const wizard = renderOnce(READY_TO_PICK);
    await wizard.completeLeadSelection("lead-9");
    await wizard.handleStepAdvance("opening");
    const done: ProspectingWizardState = {
      ...wizardState(),
      currentStepId: "agent",
      openingMessage: Array.from({ length: 30 }, () => "word").join(" "),
      agentDesign: "x".repeat(60),
    };
    expect(canSubmitProspectingBrief(done)).toBe(true);
    expect(firstIncompleteProspectingStep(done)).toBeNull();
  });
});

describe("helpers", () => {
  it("advanceWizardStep keeps everything else; leaving Welcome Briefing completes onboarding", () => {
    expect(advanceWizardStep({ ...READY_TO_PICK, selectedLeadId: "lead-9" }, "opening")).toMatchObject({
      currentStepId: "opening",
      selectedLeadId: "lead-9",
      shortlistedCompanyIds: ["dir-1", "dir-2", "dir-3"],
    });
    expect(advanceWizardStep({ ...DEFAULT_PROSPECTING_WIZARD_STATE, onboardingComplete: false }, "icp").onboardingComplete).toBe(true);
  });

  it("firstIncompleteProspectingStep names what still blocks Submit", () => {
    const agentDone = { ...READY_TO_PICK, openingMessage: Array.from({ length: 30 }, () => "w").join(" "), agentDesign: "x".repeat(60) };
    expect(firstIncompleteProspectingStep(agentDone)?.label).toBe("Select Target Lead");
    expect(firstIncompleteProspectingStep({ ...agentDone, selectedLeadId: "lead-9", shortlistedCompanyIds: ["dir-1"] })?.label).toBe("Data Room");
  });
});
