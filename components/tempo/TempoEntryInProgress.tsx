/**
 * TempoEntryInProgress.tsx
 * In-progress briefing layout for the Tempo simulation entry page — shown after Stage 1 begins.
 * Structural reference: Stitch "Simulation Entry - In Progress" with dynamic stage data.
 * Assignment Objective shows Key KPI and Sim Time as plain facts and the onboarding
 * video button; the roadmap shows each stage's expected time; the bottom row has
 * Continue, then Restart (stacked full width on mobile).
 */

import Link from "next/link";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoOnboardingVideoTrigger } from "@/components/tempo/TempoOnboardingVideoModal";
import { RestartSimulationButton } from "@/components/simulation/RestartSimulationButton";
import {
  TEMPO_STAGES,
  getCurrentTempoStage,
  normalizeToTempoStageKey,
  type TempoStageDefinition,
} from "@/lib/tempo-simulation";
import type { SimulationStage } from "@/types";

type TempoEntryInProgressProps = {
  classId: string;
  simulationId: string;
  simulationTitle: string;
  ctaHref: string;
  ctaLabel: string;
  currentStage: SimulationStage;
  completedStageKeys: ReadonlySet<string>;
  restartAttemptId: string | null;
};

type StageObjective = {
  objective: string;
  kpiLabel: string;
  simTime: string;
};

/** Tempo-specific assignment objectives keyed by simulation stage. */
const TEMPO_STAGE_OBJECTIVES: Record<SimulationStage, StageObjective> = {
  lead_gen: {
    objective:
      "Define your ideal customer profile, research the candidate directory, qualify the strongest account, and craft your opening outreach to the decision maker who owns this purchase.",
    kpiLabel: "ICP Fit Score",
    simTime: "15 Minutes",
  },
  prospecting: {
    objective:
      "Define your ideal customer profile, research the candidate directory, qualify the strongest account, and craft your opening outreach to the decision maker who owns this purchase.",
    kpiLabel: "ICP Fit Score",
    simTime: "15 Minutes",
  },
  discovery: {
    objective:
      "On your live call with Dana Reyes, uncover at least three operational pain points — staffing, no-shows, and front-desk overload — without pitching Tempo yet.",
    kpiLabel: "Discovery Depth",
    simTime: "20 Minutes",
  },
  presentation: {
    objective:
      "Write a tailored pitch connecting Tempo's scheduling automation to Summit Dental's specific revenue and staffing challenges. Show your AI-assisted work.",
    kpiLabel: "Value Alignment",
    simTime: "10 Minutes",
  },
  objections: {
    objective:
      "On your follow-up call with Dr. Saul Kim, address his concerns about cost, adoption risk, and integration with their existing PMP — and keep the deal alive.",
    kpiLabel: "Objection Handling %",
    simTime: "15 Minutes",
  },
  close: {
    objective:
      "Navigate two written negotiation scenarios — defend your per-location pricing and manage concessions to close Summit Dental on an annual contract.",
    kpiLabel: "Close Rate",
    simTime: "10 Minutes",
  },
  results: {
    objective: "Review your simulation results and manager feedback.",
    kpiLabel: "Overall Score",
    simTime: "—",
  },
};

type RoadmapNodeStatus = "completed" | "current" | "upcoming";

/**
 * Resolves roadmap node visual state from stage index vs current stage.
 */
function getRoadmapStatus(
  stage: TempoStageDefinition,
  currentStage: SimulationStage,
  completedStageKeys: ReadonlySet<string>
): RoadmapNodeStatus {
  const normalizedCurrent = normalizeToTempoStageKey(currentStage);
  const currentIndex = TEMPO_STAGES.findIndex((s) => s.stageKey === normalizedCurrent);
  const stageIndex = stage.number - 1;

  if (completedStageKeys.has(stage.stageKey) || (currentIndex >= 0 && stageIndex < currentIndex)) {
    return "completed";
  }
  if (stage.stageKey === normalizedCurrent) {
    return "current";
  }
  return "upcoming";
}

/**
 * Renders one node in the horizontal simulation roadmap.
 */
function RoadmapNode({
  stage,
  status,
}: {
  stage: TempoStageDefinition;
  status: RoadmapNodeStatus;
}): React.ReactElement {
  const icon =
    stage.stageKey === "discovery"
      ? "forum"
      : stage.stageKey === "objections"
        ? "shield"
        : stage.icon;
  // Same size and font as the fresh-start roadmap's time; a light tone, since this roadmap is on navy.
  const time = <p className="mt-1 text-[11px] font-code-md text-white/60">{stage.time}</p>;

  if (status === "completed") {
    return (
      <div className="flex flex-col items-center gap-4 bg-primary-container px-4">
        <div className="w-12 h-12 rounded-full bg-tertiary-container flex items-center justify-center text-on-tertiary-fixed shadow-sm border-2 border-tertiary-container">
          <MaterialIcon name="check" filled />
        </div>
        <div className="text-center">
          <p className="font-code-md text-tertiary-fixed font-bold text-[13px]">STAGE {stage.number}</p>
          <p className="text-body-md font-bold text-white">{stage.title}</p>
          {time}
        </div>
      </div>
    );
  }

  if (status === "current") {
    return (
      <div className="flex flex-col items-center gap-4 bg-primary-container px-4">
        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-tertiary-fixed border-2 border-tertiary-fixed animate-pulse shadow-sm">
          <MaterialIcon name={icon} />
        </div>
        <div className="text-center">
          <p className="font-code-md text-tertiary-fixed font-bold text-[13px]">STAGE {stage.number}</p>
          <p className="text-body-md font-bold text-white">{stage.title}</p>
          {time}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 bg-primary-container px-4">
      <div className="w-12 h-12 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-white/80">
        <MaterialIcon name={icon} />
      </div>
      <div className="text-center">
        <p className="font-code-md text-white/70 font-bold text-[13px]">STAGE {stage.number}</p>
        <p className="text-body-md font-bold text-white/85">{stage.title}</p>
        {time}
      </div>
    </div>
  );
}

/**
 * Renders the Tempo simulation entry page for students with an in-progress attempt.
 */
export function TempoEntryInProgress({
  classId,
  simulationId,
  simulationTitle,
  ctaHref,
  ctaLabel,
  currentStage,
  completedStageKeys,
  restartAttemptId,
}: TempoEntryInProgressProps): React.ReactElement {
  const currentTempoStage = getCurrentTempoStage(currentStage);
  const stageNumber = currentTempoStage?.number ?? 1;
  const stageObjective = TEMPO_STAGE_OBJECTIVES[currentStage] ?? TEMPO_STAGE_OBJECTIVES.prospecting;
  const entryRedirectHref = `/student/simulation/${simulationId}/entry?classId=${classId}`;

  return (
    <div className="animate-fade-in-up flex flex-col min-h-full bg-primary-container">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Hero */}
        <section className="bg-primary-container py-16 px-6 lg:px-8 relative overflow-hidden">
          <div className="max-w-6xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
            <Link
              href={`/student/classes/${classId}`}
              className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
            >
              <MaterialIcon name="arrow_back" className="text-[18px]" />
              Back
            </Link>
          </div>
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
            <div className="space-y-6">
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[12px] font-bold tracking-widest uppercase">
                IN PROGRESS
              </div>
              <h1 className="text-[48px] leading-[56px] font-bold text-white">
                Rehearse Essentials: Stage {stageNumber}
              </h1>
              <p className="text-body-lg text-white/70 max-w-lg">
                {stageNumber > 1
                  ? `You have successfully completed the ${TEMPO_STAGES[stageNumber - 2]?.title ?? "previous"} phase. Now, engage with your prospect to advance the deal.`
                  : "Your simulation is underway. Complete Stage 1 to identify your target account and unlock your discovery call."}
              </p>
            </div>

            {/* CRM Card */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 shadow-xl">
              <div className="flex items-center justify-between mb-6 border-b border-outline-variant pb-4">
                <div className="flex items-center gap-3">
                  <MaterialIcon name="hub" className="text-secondary" />
                  <span className="font-bold text-on-surface">CRM Context: Your Active Deal</span>
                </div>
                <span className="font-code-md text-outline uppercase tracking-tighter text-[13px]">
                  Deal ID: 8849-B
                </span>
              </div>
              <div className="space-y-4">
                {[
                  { label: "Lead Name", value: "Tracked in your CRM" },
                  { label: "Role", value: "Tracked in your CRM" },
                  { label: "Industry", value: "Appointment-based services" },
                  { label: "Region", value: "Mountain West" },
                  { label: "Est. Deal Value", value: "$14,600/yr", highlight: true },
                  { label: "Product", value: "Tempo" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between items-center p-3 bg-surface-container-low rounded-lg"
                  >
                    <span className="text-on-surface-variant">{row.label}</span>
                    <span
                      className={`font-medium ${row.highlight ? "text-tertiary-container" : "text-on-surface"}`}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Assignment & Product bento */}
        <section className="px-6 lg:px-8 py-12 max-w-6xl mx-auto w-full">
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 md:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-xl p-8">
              <div className="flex items-center gap-2 text-secondary mb-4">
                <MaterialIcon name="task_alt" />
                <h3 className="text-headline-md font-bold">Assignment Objective</h3>
              </div>
              <p className="text-body-lg text-on-surface-variant mb-6 leading-relaxed">
                {stageObjective.objective}
              </p>
              {/* Plain facts, not buttons: one row with a thin divider (stacked on mobile). */}
              <dl className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="verified" className="text-secondary text-[20px]" />
                  <dt className="font-bold text-on-surface">Key KPI</dt>
                  <dd className="text-body-md text-on-surface-variant">{stageObjective.kpiLabel}</dd>
                </div>
                <div className="flex items-center gap-2 sm:border-l sm:border-outline-variant sm:pl-6">
                  <MaterialIcon name="timer" className="text-secondary text-[20px]" />
                  <dt className="font-bold text-on-surface">Sim Time</dt>
                  <dd className="text-body-md text-on-surface-variant">{stageObjective.simTime}</dd>
                </div>
              </dl>
              <div className="mt-6">
                <TempoOnboardingVideoTrigger />
              </div>
            </div>
            <div className="col-span-12 md:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-8 flex flex-col justify-center items-center text-center">
              <div className="w-20 h-20 bg-secondary-container rounded-2xl flex items-center justify-center mb-4">
                <MaterialIcon name="inventory_2" className="text-secondary scale-150" />
              </div>
              <h3 className="text-headline-md font-bold mb-2">Product Focus</h3>
              <p className="text-body-md text-on-surface-variant">Tempo</p>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section className="bg-primary-container py-16 px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-headline-md text-white mb-12 text-center">Simulation Roadmap</h2>
            <div className="relative">
              <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/20 -translate-y-1/2 z-0 hidden md:block" />
              <div className="relative z-10 flex flex-col md:flex-row justify-between gap-8 md:gap-4">
                {TEMPO_STAGES.map((stage) => (
                  <RoadmapNode
                    key={stage.number}
                    stage={stage}
                    status={getRoadmapStatus(stage, currentStage, completedStageKeys)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary-container py-20 px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center flex flex-col items-center gap-4">
            {/* Continue, then Restart; stacked full width on mobile. */}
            <div className="w-full sm:w-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <Link
                href={ctaHref}
                className="bg-tertiary-container hover:opacity-90 text-on-tertiary-fixed font-bold text-base h-12 px-6 rounded-lg transition-all active:scale-95 shadow-lg flex items-center justify-center gap-3 group"
              >
                {ctaLabel}
                <MaterialIcon name="arrow_forward" className="group-hover:translate-x-1 transition-transform" />
              </Link>
              {restartAttemptId && (
                <RestartSimulationButton
                  attemptId={restartAttemptId}
                  simulationId={simulationId}
                  classId={classId}
                  simulationTitle={simulationTitle}
                  variant="danger"
                  redirectHref={entryRedirectHref}
                />
              )}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
