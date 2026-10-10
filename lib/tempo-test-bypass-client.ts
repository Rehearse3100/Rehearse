/**
 * tempo-test-bypass-client.ts
 * Client-safe [TEST] autofill helpers for Tempo stages when testBypass is on.
 * Never reads process.env — the boolean arrives as a server page prop.
 * When bypass is off, strip helpers clear leftover [TEST] autofill so it cannot leak.
 */

import type { DiscoveryPreCallPrep } from "@/lib/tempo-discovery";
import {
  createInitialNegotiationData,
  type NegotiationStageData,
} from "@/lib/tempo-negotiation";
import type { PresentationForm } from "@/lib/tempo-presentation";
import type { ProspectingWizardState } from "@/lib/tempo-prospecting";

export const TEST_BYPASS_PREFIX = "[TEST]";

/** Size defaults from server autofill (no [TEST] prefix — cleared only with other test markers). */
const TEST_BYPASS_SIZE_MIN = "5";
const TEST_BYPASS_SIZE_MAX = "20";

/**
 * True when a string is a test-bypass autofill value.
 */
export function isTestBypassAutofillValue(value: string): boolean {
  return value.trim().startsWith(TEST_BYPASS_PREFIX);
}

/**
 * Clears a string when it is test-bypass autofill; otherwise returns it unchanged.
 */
export function stripTestBypassString(value: string): string {
  return isTestBypassAutofillValue(value) ? "" : value;
}

/**
 * Clears [TEST]-prefixed values from a flat string record (CRM fields, etc.).
 */
export function stripTestBypassRecord(
  fields: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    next[key] = typeof value === "string" ? stripTestBypassString(value) : "";
  }
  return next;
}

/**
 * Removes leftover Prospecting wizard autofill when bypass is off.
 */
export function stripWizardTestAutofill(
  state: ProspectingWizardState
): ProspectingWizardState {
  const next: ProspectingWizardState = { ...state, selfCheck: { ...state.selfCheck } };

  const textKeys = [
    "icpTargetVerticals",
    "icpDecisionMakerRole",
    "icpOperationalSignals",
    "icpDisqualifier1",
    "icpDisqualifier2",
    "icpDisqualifier3",
    "openingMessage",
    "agentDesign",
    "agentCorrections",
  ] as const;

  let clearedTestText = false;
  for (const key of textKeys) {
    if (isTestBypassAutofillValue(next[key])) {
      next[key] = "";
      clearedTestText = true;
    }
  }

  // Size autofill has no [TEST] prefix — clear only with other test markers present.
  if (clearedTestText) {
    if (next.icpSizeMinLocations.trim() === TEST_BYPASS_SIZE_MIN) {
      next.icpSizeMinLocations = "";
    }
    if (next.icpSizeMaxLocations.trim() === TEST_BYPASS_SIZE_MAX) {
      next.icpSizeMaxLocations = "";
    }
  }

  return next;
}

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
 * Clears Discovery prep autofill leftovers.
 */
export function stripDiscoveryPrepTestAutofill(
  form: DiscoveryPreCallPrep
): DiscoveryPreCallPrep {
  return {
    openQuestions: [
      stripTestBypassString(form.openQuestions[0]),
      stripTestBypassString(form.openQuestions[1]),
      stripTestBypassString(form.openQuestions[2]),
    ],
    anticipatedProbe: stripTestBypassString(form.anticipatedProbe),
    anticipatedConfirm: stripTestBypassString(form.anticipatedConfirm),
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
 * Clears Presentation autofill leftovers.
 */
export function stripPresentationTestAutofill(form: PresentationForm): PresentationForm {
  return {
    businessCase: stripTestBypassString(form.businessCase),
    underlyingPainPoints: stripTestBypassString(form.underlyingPainPoints),
    solution: stripTestBypassString(form.solution),
    proofPoint: stripTestBypassString(form.proofPoint),
    powerStakeholder: stripTestBypassString(form.powerStakeholder),
    nextStep: stripTestBypassString(form.nextStep),
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

/**
 * Clears Negotiation AI-work autofill leftovers (does not reset scenario progress).
 */
export function stripNegotiationTestAutofill(
  data: NegotiationStageData
): NegotiationStageData {
  const base = data ?? createInitialNegotiationData();
  return {
    ...base,
    aiWork: {
      prompts: stripTestBypassString(base.aiWork.prompts),
      corrections: stripTestBypassString(base.aiWork.corrections),
    },
  };
}
