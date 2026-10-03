/**
 * attempt-progress.ts
 * Shared helpers for detecting whether a student has meaningfully started an attempt.
 */

import type { SimulationStage } from "@/types";

type AttemptProgressFields = {
  current_stage?: SimulationStage | string | null;
  stage_data?: unknown;
  started_at?: string | null;
};

/**
 * True when an in_progress attempt has real student progress — not a blank lead_gen shell.
 * Matches Tempo entry mid-sim rules: ICP / wizard draft in stage_data, or past lead_gen,
 * or any completed stage_scores rows.
 */
export function attemptHasStartedProgress(options: {
  currentStage: SimulationStage | string | null | undefined;
  stageData: unknown;
  stagesCompleted?: number;
}): boolean {
  if ((options.stagesCompleted ?? 0) > 0) {
    return true;
  }

  const stage = options.currentStage ?? null;
  if (!stage) {
    return false;
  }

  // Anything past the Stage-1 shell means the student is mid-simulation.
  if (stage !== "lead_gen") {
    return true;
  }

  return stageDataHasMeaningfulProgress(options.stageData);
}

/**
 * True when stage_data contains ICP / prospecting wizard progress (not null/empty).
 */
export function stageDataHasMeaningfulProgress(stageData: unknown): boolean {
  if (stageData == null || typeof stageData !== "object") {
    return false;
  }

  const data = stageData as Record<string, unknown>;
  if (Object.keys(data).length === 0) {
    return false;
  }

  if (data.icp != null) {
    return true;
  }
  if (data.icpGateComplete === true) {
    return true;
  }
  if (
    typeof data.currentStepId === "string" &&
    data.currentStepId.trim() !== "" &&
    data.currentStepId !== "onboarding"
  ) {
    return true;
  }
  if (typeof data.selectedLeadId === "string" && data.selectedLeadId.trim()) {
    return true;
  }
  if (typeof data.openingMessage === "string" && data.openingMessage.trim()) {
    return true;
  }
  if (data.companyChats && typeof data.companyChats === "object") {
    const chats = data.companyChats as Record<string, unknown>;
    if (Object.keys(chats).length > 0) {
      return true;
    }
  }

  // Any other persisted keys (directory cache, handoff flags, etc.) count as started.
  return Object.keys(data).length > 0;
}

/**
 * Picks the best in-progress attempt: prefer one with real progress, else newest.
 * Avoids blank newer lead_gen shells masking an older attempt that has ICP/wizard data.
 */
export function pickPreferredInProgressAttempt<T extends AttemptProgressFields>(
  rows: T[] | null | undefined
): T | null {
  if (!rows?.length) {
    return null;
  }

  const withProgress = rows.filter((row) =>
    attemptHasStartedProgress({
      currentStage: row.current_stage,
      stageData: row.stage_data,
    })
  );

  const pool = withProgress.length > 0 ? withProgress : rows;
  return (
    [...pool].sort((a, b) => {
      const aTime = a.started_at ? Date.parse(a.started_at) : 0;
      const bTime = b.started_at ? Date.parse(b.started_at) : 0;
      return bTime - aTime;
    })[0] ?? null
  );
}
