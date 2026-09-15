/**
 * tempo-negotiation.ts
 * Types, copy, and helpers for Tempo Stage 5 Negotiation (default class only).
 */

import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";
import type { ObjectionSummaryForm } from "@/lib/tempo-objections";
import type { PresentationForm } from "@/lib/tempo-presentation";

export type NegotiationScenario = "A" | "B";
export type ScenarioState = "locked" | "active" | "complete";
export type TurnState = "locked" | "active" | "submitted";
export type NegotiationOutcomeStatus = "deal_agreed" | "kim_walked" | "partial_close";

export interface NegotiationTurn {
  kimMessage: string;
  studentResponse: string;
  state: TurnState;
}

export interface NegotiationOutcome {
  status: NegotiationOutcomeStatus;
  message: string;
}

export interface NegotiationScenarioData {
  turns: [NegotiationTurn, NegotiationTurn, NegotiationTurn];
  outcome: NegotiationOutcome | null;
}

export interface NegotiationAiWork {
  prompts: string;
  corrections: string;
}

export interface NegotiationStageData {
  activeScenario: NegotiationScenario;
  scenarioAState: ScenarioState;
  scenarioBState: ScenarioState;
  scenarioA: NegotiationScenarioData;
  scenarioB: NegotiationScenarioData;
  aiWork: NegotiationAiWork;
}

export const NEGOTIATION_MIN_WORDS = 40;

export const SCENARIO_A_OPENING =
  "Your software fits our needs, but $1,432 a month across eight locations — that's over $17,000 a year. I can get SlotEasy for half that. Take 25% off right now or I don't think we can move forward.";

export const SCENARIO_B_OPENING =
  "Okay, I'm willing to move forward — but I want better terms. Monthly billing, no annual lock-in. And I want you to throw in the onboarding for free. Dana also wants to add the ninth location we're planning. What can you do?";

export const TRADEABLE_LEVERS = [
  { lever: "Annual commitment", give: "15% off", get: "12-month lock" },
  { lever: "Onboarding fee", give: "Waive $500/loc", get: "Faster start" },
  { lever: "Location count", give: "Add 9th location", get: "Higher ACV" },
  { lever: "Monthly billing", give: "Monthly option", get: "Higher rate" },
  { lever: "Tier", give: "Stay on Pro", get: "Full features" },
] as const;

export const NEGOTIATION_STRATEGY_TIPS = [
  "Trade, don't concede — give something to get something",
  "Find Kim's true priority — certainty it works",
  "Protect the deal value — don't give away margin",
  "A pilot offer lowers his risk of saying yes",
] as const;

export type PriorContextItem = {
  label: string;
  text: string;
  fromStudent: boolean;
};

export type PriorContextSection = {
  stageLabel: string;
  borderClass: "border-primary" | "border-secondary" | "border-tertiary-container";
  items: PriorContextItem[];
};

/** Summit Dental / Tempo reference copy when earlier stages were skipped (e.g. test shortcut). */
const PRIOR_CONTEXT_FALLBACKS = {
  discovery: {
    businessIssue:
      "Summit Dental's manual phone scheduling is breaking down at 8 locations — no-shows, front desk overload, and lost after-hours demand as they scale.",
    keyProblems:
      "The new 8th location exposed the limits of their phone-based system; front desk staff are drowning in confirmation calls.",
    quantifiedValue:
      "No-show rate around 18%; front desk spends most of the day on scheduling calls; significant demand after hours goes uncaptured.",
    personalValue:
      "Dana Reyes was hired to get operations under control before Dr. Kim loses confidence in the expansion.",
    nextStep:
      "Dana agreed to a follow-up presentation with her and Dr. Kim to review a tailored Tempo proposal.",
  },
  presentation: {
    businessCase:
      "Eight practices on manual scheduling — no-shows near 1 in 6, front desk overloaded, no after-hours capture — with Dana under pressure as they scale.",
    underlyingPainPoints:
      "Front desk drowning in confirmation calls; after-hours demand uncaptured; expansion exposing phone-based scheduling limits.",
    solution:
      "Automated reminders and self-service booking cut no-shows and free front-desk time across all eight locations.",
    proofPoint:
      "Tempo customers see ~35% no-show reduction in 90 days and meaningful after-hours booking volume.",
    powerStakeholder:
      "Dana owns operational pain; Dr. Kim owns the budget and wants proof it pays for itself before committing.",
    nextStep:
      "Present to Dana and Dr. Kim with a concrete rollout plan and ROI tied to Summit's expansion.",
  },
  objections: {
    objectionsRaised:
      "Price across eight locations, front desk adoption risk, and skepticism that the status quo isn't good enough.",
    rootConcerns:
      "Kim isn't convinced ROI is real, fears a disruptive rollout, and under-counts the cost of manual scheduling chaos.",
    howYouResponded:
      "Acknowledge each concern, re-anchor on no-show recovery and front desk time saved, and resist immediate discounting.",
    priceAndDiscounting:
      "Kim pushes on monthly cost; hold price and trade value — onboarding support, commitment term, or scope — not margin.",
    nextStep:
      "Earn enough confidence to move to final terms negotiation with Dana on implementation details.",
  },
} as const satisfies Record<string, Record<string, string>>;

const MIN_STUDENT_FIELD_LENGTH = 12;

function resolvePriorField(
  label: string,
  studentValue: string | undefined,
  fallback: string
): PriorContextItem {
  const trimmed = studentValue?.trim() ?? "";
  if (trimmed.length >= MIN_STUDENT_FIELD_LENGTH) {
    return { label, text: trimmed, fromStudent: true };
  }
  return { label, text: fallback, fromStudent: false };
}

/**
 * Builds Prior Context sections from saved stage work, with Tempo simulation fallbacks.
 */
export function buildNegotiationPriorContext(
  discoverySummary: Partial<DiscoverySummaryForm> | null,
  presentationSummary: Partial<PresentationForm> | null,
  objectionSummary: Partial<ObjectionSummaryForm> | null
): PriorContextSection[] {
  const discoveryFields: {
    label: string;
    key: keyof typeof PRIOR_CONTEXT_FALLBACKS.discovery;
  }[] = [
    { label: "Business Issue", key: "businessIssue" },
    { label: "Key Problems", key: "keyProblems" },
    { label: "Quantified Value", key: "quantifiedValue" },
    { label: "Personal Value", key: "personalValue" },
    { label: "Agreed Next Step", key: "nextStep" },
  ];

  const presentationFields: {
    label: string;
    key: keyof typeof PRIOR_CONTEXT_FALLBACKS.presentation;
  }[] = [
    { label: "Business Issue", key: "businessCase" },
    { label: "Problem", key: "underlyingPainPoints" },
    { label: "Solution", key: "solution" },
    { label: "Value", key: "proofPoint" },
    { label: "Power", key: "powerStakeholder" },
    { label: "Plan", key: "nextStep" },
  ];

  const objectionFields: {
    label: string;
    key: keyof typeof PRIOR_CONTEXT_FALLBACKS.objections;
  }[] = [
    { label: "Objections Raised", key: "objectionsRaised" },
    { label: "Root Concerns", key: "rootConcerns" },
    { label: "How You Responded", key: "howYouResponded" },
    { label: "Price & Discounting", key: "priceAndDiscounting" },
    { label: "Next Step", key: "nextStep" },
  ];

  return [
    {
      stageLabel: "Stage 2: Discovery",
      borderClass: "border-tertiary-container",
      items: discoveryFields.map(({ label, key }) =>
        resolvePriorField(label, discoverySummary?.[key], PRIOR_CONTEXT_FALLBACKS.discovery[key])
      ),
    },
    {
      stageLabel: "Stage 3: Presentation",
      borderClass: "border-primary",
      items: presentationFields.map(({ label, key }) =>
        resolvePriorField(
          label,
          presentationSummary?.[key],
          PRIOR_CONTEXT_FALLBACKS.presentation[key]
        )
      ),
    },
    {
      stageLabel: "Stage 4: Objection Handling",
      borderClass: "border-secondary",
      items: objectionFields.map(({ label, key }) =>
        resolvePriorField(label, objectionSummary?.[key], PRIOR_CONTEXT_FALLBACKS.objections[key])
      ),
    },
  ];
}

function createInitialTurns(opening: string): [NegotiationTurn, NegotiationTurn, NegotiationTurn] {
  return [
    { kimMessage: opening, studentResponse: "", state: "active" },
    { kimMessage: "", studentResponse: "", state: "locked" },
    { kimMessage: "", studentResponse: "", state: "locked" },
  ];
}

export const EMPTY_NEGOTIATION_AI_WORK: NegotiationAiWork = {
  prompts: "",
  corrections: "",
};

export function createInitialNegotiationData(): NegotiationStageData {
  return {
    activeScenario: "A",
    scenarioAState: "active",
    scenarioBState: "locked",
    scenarioA: { turns: createInitialTurns(SCENARIO_A_OPENING), outcome: null },
    scenarioB: { turns: createInitialTurns(SCENARIO_B_OPENING), outcome: null },
    aiWork: { ...EMPTY_NEGOTIATION_AI_WORK },
  };
}

/**
 * Counts non-empty words in a draft response.
 */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Returns a short human-readable outcome label for scenario summary cards.
 */
export function getOutcomeStatusLabel(outcome: NegotiationOutcome | null): string {
  if (!outcome) {
    return "Deal terms agreed";
  }
  if (outcome.status === "deal_agreed") {
    return "Value defended — moving forward without unnecessary discount";
  }
  if (outcome.status === "kim_walked") {
    return "Kim walked — terms could not be aligned";
  }
  return "Partial agreement — some terms still open";
}

/**
 * Parses objection stage transcript JSON for prior-context panel.
 */
export function parseObjectionSummaryFromTranscript(
  transcript: string | undefined | null
): Partial<ObjectionSummaryForm> | null {
  if (!transcript?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(transcript) as { postCallSummary?: Partial<ObjectionSummaryForm> };
    return parsed.postCallSummary ?? null;
  } catch {
    return null;
  }
}

export function canSubmitNegotiation(data: NegotiationStageData): boolean {
  return (
    data.scenarioAState === "complete" &&
    data.scenarioBState === "complete" &&
    data.aiWork.prompts.trim().length > 20 &&
    data.aiWork.corrections.trim().length > 20
  );
}

export function getNegotiationStorageKey(attemptId: string): string {
  return `tempo-negotiation-${attemptId}`;
}

export function loadNegotiationFromStorage(attemptId: string): NegotiationStageData | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(getNegotiationStorageKey(attemptId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as NegotiationStageData;
  } catch {
    return null;
  }
}

export function saveNegotiationToStorage(attemptId: string, data: NegotiationStageData): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(getNegotiationStorageKey(attemptId), JSON.stringify(data));
}

/**
 * Clears negotiation draft from localStorage (e.g. on simulation restart).
 */
export function clearNegotiationFromStorage(attemptId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(getNegotiationStorageKey(attemptId));
  } catch {
    /* ignore */
  }
}

/**
 * Parses GPT outcome block from the final negotiation turn reply.
 */
export function parseNegotiationOutcome(reply: string): {
  kimTail: string;
  outcome: NegotiationOutcome | null;
} {
  if (!reply.includes("OUTCOME:")) {
    return { kimTail: reply.trim(), outcome: null };
  }

  const lines = reply.split("\n");
  const outcomeIndex = lines.findIndex((line) => line.startsWith("OUTCOME:"));
  if (outcomeIndex < 0) {
    return { kimTail: reply.trim(), outcome: null };
  }

  const kimTail = lines.slice(0, outcomeIndex).join("\n").trim();
  const outcomeCode = lines[outcomeIndex]?.replace("OUTCOME:", "").trim() as
    | NegotiationOutcomeStatus
    | undefined;
  const outcomeMessage =
    lines
      .slice(outcomeIndex + 1)
      .join(" ")
      .trim() || kimTail;

  const status: NegotiationOutcomeStatus =
    outcomeCode === "kim_walked" || outcomeCode === "partial_close"
      ? outcomeCode
      : "deal_agreed";

  return {
    kimTail,
    outcome: { status, message: outcomeMessage },
  };
}
