/**
 * ProspectingStage.tsx
 * Phone-call UI (voice only, no avatar video) via PhoneCallStage orchestrator.
 */

"use client";

import { CALL_STAGE_MIN_HEIGHT_CLASS, CALL_STAGE_MIN_HEIGHT_VH } from "@/components/call/CallLayout";
import { PhoneCallStage } from "@/components/call/PhoneCallStage";
import type { Simulation, SimulationStage } from "@/types";

type ProspectingStageProps = {
  simulation: Simulation;
  attemptId: string;
  onComplete: (nextStage: SimulationStage) => void;
};

/**
 * Prospecting — cold call with waveform UI; no video avatar.
 */
export function ProspectingStage({
  simulation,
  attemptId,
  onComplete,
}: ProspectingStageProps): React.ReactElement {
  return (
    <div
      className={`${CALL_STAGE_MIN_HEIGHT_CLASS} flex flex-col flex-1 min-h-0 h-full`}
      style={{ minHeight: `${CALL_STAGE_MIN_HEIGHT_VH}vh` }}
    >
      <PhoneCallStage
        simulation={simulation}
        attemptId={attemptId}
        onAdvance={() => onComplete("discovery")}
      />
    </div>
  );
}
