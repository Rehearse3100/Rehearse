/**
 * CloseStage.tsx
 * Final voice-only call to close the sale; scored from call transcript.
 */

"use client";

import { PhoneCallStage } from "@/components/call/PhoneCallStage";
import type { Simulation, StageScore } from "@/types";

type CloseStageProps = {
  simulation: Simulation;
  attemptId: string;
  stageScores: StageScore[];
  runningTotalScore: number;
  onComplete: () => void;
};

/**
 * Close — audio call with persona; transcript scored and saved on end call.
 */
export function CloseStage({
  simulation,
  attemptId,
  stageScores,
  runningTotalScore,
  onComplete,
}: CloseStageProps): React.ReactElement {
  const priorSummary = stageScores
    .filter((s) => s.stage !== "close")
    .map((s) => `${s.stage}: ${s.score}/100`)
    .join("\n");

  return (
    <PhoneCallStage
      simulation={simulation}
      attemptId={attemptId}
      callStage="close"
      scoreStage="close"
      openingGreeting={`Alright — if you want me to move forward, convince me it's worth it.`}
      runningTotalScore={runningTotalScore}
      priorStagesSummary={priorSummary.length > 0 ? priorSummary : undefined}
      scoreTranscriptExtra={priorSummary.length > 0 ? `Prior stages:\n${priorSummary}` : undefined}
      advanceLabel="View final results →"
      onAdvance={onComplete}
    />
  );
}
