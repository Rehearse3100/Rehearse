/**
 * tempo-simulation.ts
 * Tempo / Summit Dental simulation entry page — stage copy, routing helpers,
 * and ID checks for the Rehearse Essentials default class.
 */

import { TEMPO_SIMULATION_ID } from "@/lib/constants";
import type { SimulationStage } from "@/types";

export type TempoStageDefinition = {
  number: number;
  title: string;
  icon: string;
  modality: string;
  description: string;
  time: string;
  noAI: boolean;
  stageKey: SimulationStage;
};

/** Playable Tempo stages shown on the entry page (5-stage flow). */
export const TEMPO_STAGES: TempoStageDefinition[] = [
  {
    number: 1,
    title: "Prospecting",
    icon: "search",
    modality: "Structured Submission",
    description:
      "Define your ideal customer, build an AI research tool, qualify Summit Dental, and write your opening outreach.",
    time: "~15 min",
    noAI: false,
    stageKey: "prospecting",
  },
  {
    number: 2,
    title: "Discovery",
    icon: "record_voice_over",
    modality: "Live Voice Call",
    description:
      "A 15-minute live call with Dana Reyes. Uncover their business issues through smart questions — no pitching yet.",
    time: "~15 min",
    noAI: true,
    stageKey: "discovery",
  },
  {
    number: 3,
    title: "Presentation",
    icon: "present_to_all",
    modality: "Structured Submission",
    description:
      "Write a tailored pitch connecting Tempo's value to Summit Dental's specific situation. Show your AI work.",
    time: "~10 min",
    noAI: false,
    stageKey: "presentation",
  },
  {
    number: 4,
    title: "Objection Handling",
    icon: "shield",
    modality: "Live Voice Call",
    description:
      "A follow-up call with Dr. Saul Kim, the owner. He has concerns about the proposal. Handle them.",
    time: "~15 min",
    noAI: true,
    stageKey: "objections",
  },
  {
    number: 5,
    title: "Negotiation",
    icon: "handshake",
    modality: "Written Scenarios",
    description:
      "Two written negotiation scenarios — defend your price and manage concessions to close the deal.",
    time: "~10 min",
    noAI: false,
    stageKey: "close",
  },
];

export const TEMPO_PRODUCT_VALUE_DRIVERS = [
  { icon: "event_available", title: "Cut No-Shows by 40%", detail: "Automated multi-channel patient reminders." },
  { icon: "support_agent", title: "Free the Front Desk", detail: "AI handles 80% of routine re-bookings." },
  { icon: "sync", title: "PMP Deep Integration", detail: "Real-time sync with Dentrix and OpenDental." },
  { icon: "insights", title: "Revenue Recovery", detail: "Fill last-minute cancellations automatically." },
] as const;

export type TempoTimelineStatus = "completed" | "current" | "upcoming";

/**
 * Returns true when this simulation should use the Tempo entry page.
 */
export function isTempoDefaultSimulation(simulationId: string, title: string): boolean {
  if (TEMPO_SIMULATION_ID.length > 0 && simulationId === TEMPO_SIMULATION_ID) {
    return true;
  }
  return title.toLowerCase().includes("tempo");
}

/**
 * Maps app stage keys to the Tempo entry timeline (lead_gen counts as prospecting).
 */
export function normalizeToTempoStageKey(stage: SimulationStage): SimulationStage {
  if (stage === "lead_gen") {
    return "prospecting";
  }
  return stage;
}

/**
 * Resolves timeline node state for an in-progress Tempo attempt.
 */
export function getTempoStageStatus(
  tempoStage: TempoStageDefinition,
  completedStageKeys: ReadonlySet<string>,
  currentStage: SimulationStage | null
): TempoTimelineStatus {
  const key = tempoStage.stageKey;
  if (completedStageKeys.has(key)) {
    return "completed";
  }

  if (!currentStage) {
    return tempoStage.number === 1 ? "current" : "upcoming";
  }

  const normalizedCurrent = normalizeToTempoStageKey(currentStage);
  const currentIndex = TEMPO_STAGES.findIndex((s) => s.stageKey === normalizedCurrent);
  const thisIndex = tempoStage.number - 1;

  if (normalizedCurrent === key) {
    return "current";
  }
  if (currentIndex >= 0 && thisIndex < currentIndex) {
    return "completed";
  }
  return "upcoming";
}

/**
 * Finds the Tempo stage metadata for the student's current simulation stage.
 */
export function getCurrentTempoStage(
  currentStage: SimulationStage | null
): TempoStageDefinition | null {
  if (!currentStage) {
    return TEMPO_STAGES[0] ?? null;
  }
  const normalized = normalizeToTempoStageKey(currentStage);
  return TEMPO_STAGES.find((s) => s.stageKey === normalized) ?? TEMPO_STAGES[0] ?? null;
}

/**
 * Builds the simulation CTA href using existing student simulation routes.
 */
export function buildTempoEntryCtaHref(
  simulationId: string,
  classId: string,
  attemptId: string | null,
  hasInProgressAttempt: boolean
): string {
  if (hasInProgressAttempt && attemptId) {
    return `/student/simulation/${simulationId}?classId=${classId}&attempt=${attemptId}`;
  }
  return `/student/simulation/${simulationId}?classId=${classId}`;
}
