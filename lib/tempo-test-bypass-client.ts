/**
 * tempo-test-bypass-client.ts
 * Client-safe [TEST] autofill helpers for Tempo stages when testBypass is on.
 * Never reads process.env — the boolean arrives as a server page prop.
 */

import type { DiscoveryPreCallPrep } from "@/lib/tempo-discovery";
import {
  createInitialNegotiationData,
  type NegotiationStageData,
} from "@/lib/tempo-negotiation";
import type { PresentationForm } from "@/lib/tempo-presentation";

export const TEST_BYPASS_PREFIX = "[TEST]";

/**
 * Fills empty Discovery OPC prep fields. Never overwrites non-empty values.
 */
export function applyDiscoveryPrepAutofill(
  form: DiscoveryPreCallPrep
): DiscoveryPreCallPrep {
  const openQuestions: [string, string, string] = [
    form.openQuestions[0].trim()
      ? form.openQuestions[0]
      : `${TEST_BYPASS_PREFIX} How is front-desk load changing as you add locations?`,
    form.openQuestions[1].trim()
      ? form.openQuestions[1]
      : `${TEST_BYPASS_PREFIX} What happens to no-shows when you open a new practice?`,
    form.openQuestions[2].trim()
      ? form.openQuestions[2]
      : `${TEST_BYPASS_PREFIX} Who owns the scheduling stack decision today?`,
  ];

  return {
    openQuestions,
    anticipatedProbe: form.anticipatedProbe.trim()
      ? form.anticipatedProbe
      : `${TEST_BYPASS_PREFIX} Probe on after-hours demand and missed calls.`,
    anticipatedConfirm: form.anticipatedConfirm.trim()
      ? form.anticipatedConfirm
      : `${TEST_BYPASS_PREFIX} Confirm Dana owns ops and feels pressure from Dr. Kim.`,
  };
}

/**
 * Fills empty Presentation fields. Never overwrites non-empty values.
 */
export function applyPresentationAutofill(form: PresentationForm): PresentationForm {
  return {
    businessCase: form.businessCase.trim()
      ? form.businessCase
      : `${TEST_BYPASS_PREFIX} Summit is losing revenue to no-shows while scaling to 8 locations.`,
    underlyingPainPoints: form.underlyingPainPoints.trim()
      ? form.underlyingPainPoints
      : `${TEST_BYPASS_PREFIX} Manual phones, front-desk overload, no after-hours capture.`,
    solution: form.solution.trim()
      ? form.solution
      : `${TEST_BYPASS_PREFIX} Tempo Pro across all sites with reminders and online booking.`,
    proofPoint: form.proofPoint.trim()
      ? form.proofPoint
      : `${TEST_BYPASS_PREFIX} Peer clinics cut no-shows ~35% within 90 days.`,
    powerStakeholder: form.powerStakeholder.trim()
      ? form.powerStakeholder
      : `${TEST_BYPASS_PREFIX} Dana champions; Dr. Kim is the economic buyer.`,
    nextStep: form.nextStep.trim()
      ? form.nextStep
      : `${TEST_BYPASS_PREFIX} Propose a two-week pilot at two locations, then annual Pro.`,
  };
}

/**
 * Marks negotiation scenarios complete and fills empty AI-work fields for submit.
 * Never overwrites non-empty AI-work text.
 */
export function applyNegotiationAutofill(data: NegotiationStageData): NegotiationStageData {
  const base = data ?? createInitialNegotiationData();
  return {
    ...base,
    scenarioAState: "complete",
    scenarioBState: "complete",
    aiWork: {
      prompts: base.aiWork.prompts.trim()
        ? base.aiWork.prompts
        : `${TEST_BYPASS_PREFIX} Draft a value-defense reply that holds price and reframes ROI.`,
      corrections: base.aiWork.corrections.trim()
        ? base.aiWork.corrections
        : `${TEST_BYPASS_PREFIX} Corrected AI draft to keep annual commitment and avoid discounting.`,
    },
  };
}
