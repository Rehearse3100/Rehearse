/**
 * ObjectionsStage.tsx
 * Anam video-call stage for handling objections after the written pitch.
 */

"use client";

import { AvatarCallStage } from "@/components/call/AvatarCallStage";
import { OBJECTIONS_COUNT } from "@/lib/constants";
import type { Simulation, SimulationStage } from "@/types";

type ObjectionsStageProps = {
  simulation: Simulation;
  attemptId: string;
  pitchText: string;
  runningTotalScore: number;
  onComplete: (nextStage: SimulationStage) => void;
};

/**
 * Objections — video call; persona raises objections from the pitch.
 */
export function ObjectionsStage({
  simulation,
  attemptId,
  pitchText,
  runningTotalScore,
  onComplete,
}: ObjectionsStageProps): React.ReactElement {
  return (
    <AvatarCallStage
      simulation={simulation}
      attemptId={attemptId}
      stage="objections"
      openingGreeting={`I read your pitch. I've got a few concerns — let's hear how you handle them.`}
      scoreStage="objections"
      runningTotalScore={runningTotalScore}
      scoreTranscriptExtra={`Pitch:\n${pitchText}`}
      advanceLabel="Next Stage"
      onAdvance={() => onComplete("close")}
      topBanner={
        <p className="shrink-0 border-b border-[#c5c5d7] bg-[#f0f3ff] px-6 py-3 text-sm text-[#454654]">
          Handle {OBJECTIONS_COUNT} objections from {simulation.persona_name} in the video call.
        </p>
      }
    />
  );
}
