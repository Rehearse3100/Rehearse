/**
 * tempo-anam-config.ts
 * Per-stage Anam avatar/voice ID resolution from simulations row only (no env fallback).
 * Used by the server-side anam-session route; client receives only session tokens.
 * AnamSessionStage is the one stage type; Avatar.tsx and the voice hooks import it as a type.
 */

/** Disables Anam's built-in LLM; client supplies GPT responses via talk stream. */
export const ANAM_CUSTOM_CLIENT_LLM_ID = "CUSTOMER_CLIENT_V1" as const;

const ANAM_STAGES = ["discovery", "objections"] as const;

export type AnamSessionStage = (typeof ANAM_STAGES)[number];

/**
 * Returns true when the stage string is a supported Anam call stage.
 */
export function isAnamSessionStage(stage: string): stage is AnamSessionStage {
  return (ANAM_STAGES as readonly string[]).includes(stage);
}

/**
 * Normalizes a jsonb map (anam_avatar_ids / anam_voice_ids) into string values.
 */
export function normalizeAnamIdMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed) {
      out[key] = trimmed;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Resolves the Anam avatar ID for a stage from simulations.anam_avatar_ids only.
 * Returns '' when missing (caller treats as error).
 */
export function getAnamAvatarId(
  stage: string,
  simulationAnamAvatarIds: Record<string, string> | null
): string {
  return simulationAnamAvatarIds?.[stage]?.trim() ?? "";
}

/**
 * Resolves the Anam voice ID for a stage from simulations.anam_voice_ids only.
 * Returns '' when missing (caller treats as error).
 */
export function getAnamVoiceId(
  stage: string,
  simulationAnamVoiceIds: Record<string, string> | null
): string {
  return simulationAnamVoiceIds?.[stage]?.trim() ?? "";
}
