/**
 * chat-personas.ts
 * The persona keys a voice or negotiation call sends to POST /api/chat instead of a
 * system prompt (client-safe: names only, never prompt text). The server builds each
 * persona's system prompt from its key (lib/server/persona-prompts.ts):
 * - "tempo_discovery" (Dana) and "tempo_objections" (Dr. Kim): the Tempo video calls;
 * - "tempo_negotiation_a" / "tempo_negotiation_b": the Tempo negotiation scenarios;
 * - "simulation": a legacy teacher-made simulation's own persona prompt, with the
 *   hint for its call stage (prospecting, discovery, objections or close).
 * Used by useSimulationVoiceSession, useProspectingVoice, useNegotiationStage and the
 * legacy call stages (components/call/).
 */

export const CHAT_PERSONAS = [
  "tempo_discovery",
  "tempo_objections",
  "tempo_negotiation_a",
  "tempo_negotiation_b",
  "simulation",
] as const;

export type ChatPersona = (typeof CHAT_PERSONAS)[number];

/** The legacy simulation call stages that have a persona hint. */
export const LEGACY_CHAT_STAGES = ["prospecting", "discovery", "objections", "close"] as const;

export type LegacyChatStage = (typeof LEGACY_CHAT_STAGES)[number];

/** The persona key, or null when the value isn't one. */
export function parseChatPersona(value: unknown): ChatPersona | null {
  return typeof value === "string" && (CHAT_PERSONAS as readonly string[]).includes(value) ? (value as ChatPersona) : null;
}

/** The legacy call stage, or null when the value isn't one. */
export function parseLegacyChatStage(value: unknown): LegacyChatStage | null {
  return typeof value === "string" && (LEGACY_CHAT_STAGES as readonly string[]).includes(value)
    ? (value as LegacyChatStage)
    : null;
}
