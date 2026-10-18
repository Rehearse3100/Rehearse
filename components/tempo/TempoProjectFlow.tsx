/**
 * TempoProjectFlow.tsx
 * Compact segmented stage timeline for Tempo top bars — completed / current / upcoming.
 * The current and upcoming segments show the stage's expected time in brackets
 * (from TEMPO_STAGES in lib/tempo-simulation.ts); completed ones show only the name.
 */

import { TEMPO_STAGES } from "@/lib/tempo-simulation";

export const TEMPO_FLOW_STAGES = [
  { id: "prospecting", label: "Prospecting" },
  { id: "discovery", label: "Discovery" },
  { id: "presentation", label: "Presentation" },
  { id: "objections", label: "Objections" },
  { id: "negotiation", label: "Negotiation" },
] as const;

export type TempoFlowStageId = (typeof TEMPO_FLOW_STAGES)[number]["id"];

type FlowStatus = "completed" | "current" | "upcoming";

type TempoProjectFlowProps = {
  /** 0-based index of the active Tempo stage. */
  currentIndex: number;
};

/**
 * Resolves segment status relative to the current stage index.
 */
function statusForIndex(index: number, currentIndex: number): FlowStatus {
  if (index < currentIndex) {
    return "completed";
  }
  if (index === currentIndex) {
    return "current";
  }
  return "upcoming";
}

/** The expected time for the flow stage at this index (stage N is TEMPO_STAGES number N), e.g. "~15 min". */
function expectedTimeForIndex(index: number): string | undefined {
  return TEMPO_STAGES.find((stage) => stage.number === index + 1)?.time;
}

/**
 * Horizontal segmented project-flow strip used in every Tempo stage top bar.
 * Completed = gold, current = left-column navy, upcoming = muted; labels live
 * in-segment, with "(~N min)" after the name on the current and upcoming stages.
 */
export function TempoProjectFlow({ currentIndex }: TempoProjectFlowProps): React.ReactElement {
  const clampedIndex = Math.max(0, Math.min(currentIndex, TEMPO_FLOW_STAGES.length - 1));

  return (
    <div
      className="flex items-center w-full h-6 sm:h-7 min-w-0"
      role="list"
      aria-label="Project flow"
    >
      {TEMPO_FLOW_STAGES.map((stage, index) => {
        const status = statusForIndex(index, clampedIndex);
        const isFirst = index === 0;
        const isLast = index === TEMPO_FLOW_STAGES.length - 1;
        const roundClass = isFirst ? "rounded-l-full" : isLast ? "rounded-r-full" : "";
        const time = status === "completed" ? undefined : expectedTimeForIndex(index);

        let segmentClass = `absolute inset-0 flex items-center justify-center px-1 bg-surface-container-highest ${roundClass}`;
        let textClass = "text-on-surface-variant/70";

        if (status === "completed") {
          segmentClass = `absolute inset-0 flex items-center justify-center px-1 bg-tertiary-container ${roundClass}`;
          textClass = "text-white";
        } else if (status === "current") {
          segmentClass = `absolute inset-0 flex items-center justify-center px-1 bg-primary-container border border-primary-container ${roundClass}`;
          textClass = "text-white font-bold";
        }

        return (
          <div
            key={stage.id}
            role="listitem"
            aria-current={status === "current" ? "step" : undefined}
            className="flex-1 h-full relative min-w-0"
          >
            <div className={segmentClass}>
              <span
                className={`font-label-md text-[8px] sm:text-[10px] tracking-wide truncate ${textClass}`}
              >
                {stage.label}
                {time ? <span className="font-normal"> ({time})</span> : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
