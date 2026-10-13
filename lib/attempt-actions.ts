/**
 * attempt-actions.ts
 * Client-side helpers for attempts and stage scores.
 */

import type { SimulationStage } from "@/types";

type CompleteStageResult = {
  nextStage: SimulationStage | null;
  totalScore: number;
  /** True for Tempo stages: badges are graded by a separate grade-badges request. */
  badgesPending?: boolean;
};

/**
 * Saves a stage score and advances the attempt to the next stage.
 * For Tempo stages the server replies with badgesPending: true, and badge grading
 * is started in the background (never awaited, never throws).
 */
export async function completeStage(
  attemptId: string,
  stage: SimulationStage,
  score: number,
  feedback: string,
  transcript: string
): Promise<CompleteStageResult> {
  const res = await fetch("/api/student/complete-stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId, stage, score, feedback, transcript }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not save stage progress.");
  }

  const result = (await res.json()) as CompleteStageResult;
  if (result.badgesPending === true) {
    requestBadgeGrading(attemptId, stage);
  }
  return result;
}

/**
 * Fire-and-forget POST to grade-badges. keepalive lets it finish if the page
 * navigates away; if it is lost, the results page finishes the grading.
 */
function requestBadgeGrading(attemptId: string, stage: SimulationStage): void {
  try {
    fetch("/api/student/grade-badges", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, stage }),
    }).catch(() => {});
  } catch {
    // fetch threw synchronously; the results page finishes any pending grading.
  }
}

/**
 * Fetches score for a stage via /api/score.
 */
export async function fetchStageScore(payload: {
  stage: SimulationStage;
  transcript?: string;
  pitchText?: string;
  studentAnswers?: { fit: string; painPoints: string; openingApproach: string };
  priorStagesSummary?: string;
  simulationContext: {
    personaName: string;
    personaRole: string;
    personaSystemPrompt: string;
    productContext: string;
    productName?: string;
  };
  runningTotalScore?: number;
}): Promise<{ score: number; feedback: string }> {
  const res = await fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Scoring failed");
  }
  return res.json() as Promise<{ score: number; feedback: string }>;
}
