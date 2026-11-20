/**
 * persona-prompts.ts — SERVER ONLY
 * The /api/chat personas' system prompts (the two Tempo negotiation scenarios) and the
 * legacy simulations' stage hints, and the builder POST /api/chat uses to turn a persona
 * key (lib/chat-personas.ts) into the exact system prompt the browser used to build and
 * send. The live call personas (Dana, Dr. Kim: CALL_PERSONAS) are not here: their prompts
 * are the shared call brain's (lib/server/call-brain.ts, POST /api/student/call-turn).
 * Never import this from a "use client" file or anything a client file imports (a test
 * walks the import graph to check); the browser sends only the persona key.
 */

import type { CallPersona } from "@/lib/call-config";
import type { ChatPersona, LegacyChatStage } from "@/lib/chat-personas";
import { OBJECTIONS_COUNT } from "@/lib/constants";
import { buildVoiceSystemPrompt } from "@/lib/persona-voice";

// The `server-only` package isn't installed; this guard fails fast if a bundle ever
// runs this module in a browser.
if (typeof window !== "undefined") {
  throw new Error("lib/server/persona-prompts.ts is server-only: persona prompts must never reach the browser.");
}

// ── Tempo negotiation (Stage 5) ───

/** Dr. Kim negotiation persona — Tempo Stage 5 Scenario A (value defense). */
export const SCENARIO_A_SYSTEM_PROMPT = `You are Dr. Saul Kim in a negotiation. The student just submitted a Tempo proposal and you are pushing for a 25% discount. You have 3 turns.

Turn 1: Push hard — "Take 25% off or we walk."
Turn 2: Based on student's response — if they held value, soften slightly but still push. If they caved immediately, push harder.
Turn 3: Final position — if student defended value well with ROI reframe, agree to move forward without the discount. If they caved, push for more.

After Turn 3, end your response with exactly one of these outcome codes on a new line:
OUTCOME:deal_agreed
OUTCOME:kim_walked
OUTCOME:partial_close

Then on the next line write a 2-3 sentence closing message explaining the outcome.` as const;

/** Dr. Kim negotiation persona — Tempo Stage 5 Scenario B (concession management). */
export const SCENARIO_B_SYSTEM_PROMPT = `You are Dr. Saul Kim in a concession management negotiation. You want: monthly billing, free onboarding, and to add a 9th location. You have 3 turns.

Trade intelligently — if the student trades (gives something to get something), engage constructively. If they just cave and give everything, push for more. If they refuse all concessions, soften and find common ground.

After Turn 3, end your response with exactly one of these outcome codes on a new line:
OUTCOME:deal_agreed
OUTCOME:kim_walked
OUTCOME:partial_close

Then on the next line write a 2-3 sentence closing message.` as const;


// ── Legacy simulations (teacher-made; the persona prompt is the simulation's own) ───

/** The fixed hint each legacy call stage appends, as its stage component wrote it. */
const LEGACY_STAGE_HINTS: Record<Exclude<LegacyChatStage, "objections">, string> = {
  prospecting: "PROSPECTING STAGE: You are on a short cold call. Be busy but fair.",
  discovery: "DISCOVERY STAGE: Answer the student's questions in character. Do not agree to buy yet.",
  close: "CLOSE STAGE: The student should ask for the sale clearly. Push back with realistic hesitation. Stay in character.",
};

/**
 * A legacy call stage's hint. Objections quotes the student's pitch: the attempt's
 * saved presentation transcript, read on the server ("" when there is none, as the
 * browser did).
 */
export function legacyStageHint(stage: LegacyChatStage, pitchText: string): string {
  if (stage === "objections") {
    return `OBJECTIONS STAGE: The student pitched: """${pitchText}""" Raise ${OBJECTIONS_COUNT} specific objections (price, timing, fit). Push back realistically.`;
  }
  return LEGACY_STAGE_HINTS[stage];
}

// ── The builder ───

export type PersonaPromptContext = {
  /** "simulation": the simulation's persona_system_prompt from the database. */
  simulationPrompt?: string;
  /** "simulation": the call stage whose hint is appended. */
  legacyStage?: LegacyChatStage | null;
  /** "simulation" at objections: the attempt's saved presentation transcript. */
  pitchText?: string;
};

/**
 * The system prompt for an /api/chat persona (every persona but the call personas),
 * byte-for-byte what the browser built before: the legacy voice calls are
 * buildVoiceSystemPrompt(base, stage hint) — base, listening rules, hint — and the
 * negotiation scenarios are the scenario prompt as it is.
 */
export function buildPersonaSystemPrompt(
  persona: Exclude<ChatPersona, CallPersona>,
  context: PersonaPromptContext = {}
): string {
  switch (persona) {
    case "tempo_negotiation_a":
      return SCENARIO_A_SYSTEM_PROMPT;
    case "tempo_negotiation_b":
      return SCENARIO_B_SYSTEM_PROMPT;
    case "simulation":
      return buildVoiceSystemPrompt(
        context.simulationPrompt ?? "",
        context.legacyStage ? legacyStageHint(context.legacyStage, context.pitchText ?? "") : undefined
      );
  }
}
