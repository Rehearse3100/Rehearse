/**
 * SimulationCard.tsx
 * Student class-detail simulation card — Stitch visual treatment.
 */

"use client";

import { SimulationStartLink } from "@/components/SimulationStartLink";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TOTAL_STAGES_COUNT } from "@/lib/constants";
import type { Simulation } from "@/types";

type SimulationCardProps = {
  simulation: Simulation;
  actionLabel: string;
  href: string;
  stagesCompleted?: number;
  /** True when an in-progress attempt exists (Continue CTA) */
  inProgress?: boolean;
  accentColor?: string;
};

/**
 * Displays simulation summary with optional in-progress progress bar.
 */
export function SimulationCard({
  simulation,
  actionLabel,
  href,
  stagesCompleted = 0,
  inProgress = false,
  accentColor = "#00000b",
}: SimulationCardProps): React.ReactElement {
  const hasProgress = stagesCompleted > 0;
  const progressPercent = Math.min(
    100,
    Math.round((stagesCompleted / TOTAL_STAGES_COUNT) * 100)
  );
  const personaLine = [simulation.persona_name, simulation.persona_role]
    .filter(Boolean)
    .join(" · ");
  const descriptionLine =
    simulation.description?.trim() || simulation.product_context?.trim() || null;

  return (
    <article
      className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm border-l-[6px] flex flex-col hover:border-outline transition-colors overflow-hidden"
      style={{ borderLeftColor: accentColor }}
    >
      <div className="p-4 lg:p-6 flex-1 flex flex-col">
        <div className="flex justify-between items-start gap-3 mb-4">
          <h4 className="font-headline-lg text-headline-lg text-primary">{simulation.title}</h4>
          <span
            className={`material-symbols-outlined p-2 rounded-full shrink-0 ${
              inProgress
                ? "text-secondary bg-secondary-container/20"
                : "text-on-surface-variant bg-surface-container"
            }`}
            aria-hidden
          >
            {inProgress ? "play_arrow" : "lock_open"}
          </span>
        </div>

        <div className="space-y-2 mb-6 flex-1">
          {personaLine && (
            <div className="flex items-center gap-2 text-on-surface-variant font-body-md text-body-md">
              <MaterialIcon name="person" className="text-[16px] shrink-0" />
              <span>{personaLine}</span>
            </div>
          )}
          {descriptionLine && (
            <div className="flex items-start gap-2 text-on-surface-variant font-body-md text-body-md">
              <MaterialIcon name="inventory_2" className="text-[16px] shrink-0 mt-0.5" />
              <span className="line-clamp-2">{descriptionLine}</span>
            </div>
          )}
        </div>

        {hasProgress ? (
          <div className="mt-auto space-y-2">
            <div className="flex justify-between items-center font-label-sm text-label-sm">
              <span className="text-on-surface-variant">Progress</span>
              <span className="font-code-md text-code-md text-primary">
                {stagesCompleted}/{TOTAL_STAGES_COUNT} stages
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="p-4 border-t border-outline-variant bg-surface/50 flex justify-end">
        <SimulationStartLink
          href={href}
          label={actionLabel}
          simulationTitle={simulation.title}
          variant={inProgress ? "continue" : "start"}
        />
      </div>
    </article>
  );
}
