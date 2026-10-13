/**
 * tempo-attempt.ts
 * Pure server-side helpers for Tempo attempts and background badge grading.
 * isTempoAttempt mirrors the rule in app/student/simulation/[id]/page.tsx;
 * the claim rule and request parsing back POST /api/student/grade-badges,
 * and complete-stage uses isTempoAttempt to decide inline vs background grading.
 * No database or network access here.
 */

import { DEFAULT_CLASS_ID } from "@/lib/constants";
import type { TempoBadgeStage } from "@/lib/tempo-badges";
import { isTempoDefaultSimulation } from "@/lib/tempo-simulation";

/** Stages that detectTempoBadges grades (the same five complete-stage checks). */
export const TEMPO_BADGE_STAGES: readonly TempoBadgeStage[] = [
  "prospecting",
  "discovery",
  "presentation",
  "objections",
  "close",
];

/** A 'grading' claim at least this old is treated as abandoned and may be re-claimed. */
export const BADGE_CLAIM_STALE_MS = 120_000;

// ── Tempo detection ───

/**
 * True when value is one of the five Tempo badge stages.
 */
export function isTempoBadgeStage(value: unknown): value is TempoBadgeStage {
  return typeof value === "string" && (TEMPO_BADGE_STAGES as readonly string[]).includes(value);
}

/**
 * Reads the title from an attempts row joined as simulations(title).
 * Supabase returns the join as an object or a one-item array; anything else is null.
 */
export function readJoinedSimulationTitle(joined: unknown): string | null {
  const row = Array.isArray(joined) ? joined[0] : joined;
  if (!row || typeof row !== "object") {
    return null;
  }
  const title = (row as { title?: unknown }).title;
  return typeof title === "string" ? title : null;
}

/**
 * Same rule as the simulation page: default class AND the Tempo simulation
 * (by id or title). A missing class, simulation id, or title means NOT Tempo,
 * so callers fall back to today's inline grading.
 */
export function isTempoAttempt(
  classId: unknown,
  simulationId: unknown,
  simulationTitle: string | null
): boolean {
  if (typeof classId !== "string" || typeof simulationId !== "string" || simulationTitle === null) {
    return false;
  }
  return classId === DEFAULT_CLASS_ID && isTempoDefaultSimulation(simulationId, simulationTitle);
}

// ── Grading claim ───

/**
 * ISO timestamp at or before which a 'grading' claim counts as stale.
 */
export function badgeClaimCutoffIso(nowMs: number): string {
  return new Date(nowMs - BADGE_CLAIM_STALE_MS).toISOString();
}

/**
 * PostgREST .or() filter for a claimable row: 'pending', or 'grading' with a
 * claim at least BADGE_CLAIM_STALE_MS old. Same rule as isBadgeGradingClaimable.
 */
export function buildBadgeClaimFilter(nowMs: number): string {
  return `badges_status.eq.pending,and(badges_status.eq.grading,badges_claimed_at.lte.${badgeClaimCutoffIso(nowMs)})`;
}

/**
 * Pure form of the claim rule: pending → claim; done → no; grading → claim only
 * when the claim is at least BADGE_CLAIM_STALE_MS old (a missing claim time never
 * matches, as in SQL).
 */
export function isBadgeGradingClaimable(
  status: string | null | undefined,
  claimedAt: string | null | undefined,
  nowMs: number
): boolean {
  if (status === "pending") {
    return true;
  }
  if (status !== "grading" || !claimedAt) {
    return false;
  }
  const claimedMs = Date.parse(claimedAt);
  if (Number.isNaN(claimedMs)) {
    return false;
  }
  return claimedMs <= Date.parse(badgeClaimCutoffIso(nowMs));
}

// ── Request parsing ───

export type GradeBadgesRequest = {
  attemptId: string;
  stage: TempoBadgeStage;
};

/**
 * Reads ONLY attemptId and stage from a grade-badges request body. Any other
 * field (transcript, badges, …) is ignored. Returns null when either is invalid.
 */
export function parseGradeBadgesBody(raw: unknown): GradeBadgesRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const body = raw as { attemptId?: unknown; stage?: unknown };
  if (typeof body.attemptId !== "string" || body.attemptId.trim().length === 0) {
    return null;
  }
  if (!isTempoBadgeStage(body.stage)) {
    return null;
  }
  return { attemptId: body.attemptId, stage: body.stage };
}
