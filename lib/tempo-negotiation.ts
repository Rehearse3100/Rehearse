/**
 * tempo-negotiation.ts
 * Types, copy, and helpers for Tempo Stage 5 Negotiation (default class only).
 */

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

/** Pricing shown with the tradeable levers in the Reference Library (Negotiation). */
export const NEGOTIATION_DEAL_MATH = [
  { label: "Pro × 8 locations annual", value: "~$14,600/yr" },
  { label: "Monthly per location", value: "$179/mo" },
] as const;

export const NEGOTIATION_DEAL_MATH_NOTE = "Kim's true priority: certainty it works, not raw price";

export const NEGOTIATION_STRATEGY_TIPS = [
  "Trade, don't concede — give something to get something",
  "Find Kim's true priority — certainty it works",
  "Protect the deal value — don't give away margin",
  "A pilot offer lowers his risk of saying yes",
] as const;

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
 * True when both scenarios and AI-work fields meet submit requirements.
 * testBypass is a server-passed boolean — this file never reads process.env.
 */
export function canSubmitNegotiation(
  data: NegotiationStageData,
  testBypass = false
): boolean {
  if (testBypass) {
    return true;
  }
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
