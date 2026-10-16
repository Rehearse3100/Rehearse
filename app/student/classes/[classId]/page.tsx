/**
 * classes/[classId]/page.tsx — student
 * Simulations assigned to one enrolled class.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { SimulationCard } from "@/components/SimulationCard";
import { StudentClassHeader } from "@/components/StudentClassHeader";
import { RefreshOnMount } from "@/components/student/RefreshOnMount";
import {
  ATTEMPT_STATUS,
  DEFAULT_CLASS_ID,
  DEFAULT_CLASS_BANNER_URL,
  DEFAULT_CLASS_DESCRIPTION,
  DEFAULT_CLASS_NAME,
} from "@/lib/constants";
import { loadStudentClassDetail } from "@/lib/student-class-data";
import { attemptHasStartedProgress, pickPreferredInProgressAttempt } from "@/lib/attempt-progress";
import { isTempoDefaultSimulation } from "@/lib/tempo-simulation";
import { getStudentSession } from "@/lib/student-session";
import { createServiceClient } from "@/lib/supabase/server";
import type { SimulationStage } from "@/types";

export const dynamic = "force-dynamic";

type PageProps = { params: { classId: string } };

type InProgressAttemptRow = {
  id: string;
  simulation_id: string;
  current_stage: SimulationStage | null;
  stage_data: unknown;
  started_at: string | null;
};

/**
 * Class detail — student picks a simulation inside one class.
 */
export default async function StudentClassPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (!session) {
    redirect("/student-login");
  }

  const classDetail = await loadStudentClassDetail(session.studentId, params.classId);
  if (!classDetail) {
    redirect("/student/dashboard");
  }

  const supabase = createServiceClient();
  // Match Tempo entry: explicitly load stage_data so ICP/wizard progress drives Continue.
  const { data: attempts } = await supabase
    .from("attempts")
    .select("id, simulation_id, current_stage, stage_data, started_at")
    .eq("student_id", session.studentId)
    .eq("class_id", params.classId)
    .eq("status", ATTEMPT_STATUS.IN_PROGRESS)
    .order("started_at", { ascending: false });

  const inProgressList = (attempts ?? []) as InProgressAttemptRow[];
  const attemptIds = inProgressList.map((a) => a.id);

  const stageCountByAttempt = new Map<string, number>();
  if (attemptIds.length > 0) {
    const { data: stageRows } = await supabase
      .from("stage_scores")
      .select("attempt_id")
      .in("attempt_id", attemptIds);

    (stageRows ?? []).forEach((row: { attempt_id: string }) => {
      const id = row.attempt_id;
      stageCountByAttempt.set(id, (stageCountByAttempt.get(id) ?? 0) + 1);
    });
  }

  const attemptBySim = new Map<string, InProgressAttemptRow>();
  const attemptsBySimId = new Map<string, InProgressAttemptRow[]>();
  for (const attempt of inProgressList) {
    const list = attemptsBySimId.get(attempt.simulation_id) ?? [];
    list.push(attempt);
    attemptsBySimId.set(attempt.simulation_id, list);
  }
  Array.from(attemptsBySimId.entries()).forEach(([simId, list]) => {
    const preferred = pickPreferredInProgressAttempt(list);
    if (preferred) {
      attemptBySim.set(simId, preferred);
    }
  });

  const isDefaultClass = params.classId === DEFAULT_CLASS_ID;
  const displayDescription = isDefaultClass
    ? DEFAULT_CLASS_DESCRIPTION
    : classDetail.description;
  const simCount = classDetail.simulations.length;

  return (
    <div className="px-4 sm:px-8 py-6 lg:py-8 space-y-8 max-w-[1440px] mx-auto">
      <RefreshOnMount />
      <Link
        href="/student/classes"
        className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors group font-label-md text-label-md"
      >
        <span className="material-symbols-outlined text-[18px] group-hover:-translate-x-1 transition-transform">
          arrow_back
        </span>
        All classes
      </Link>

      {isDefaultClass ? (
        <div className="relative rounded-xl overflow-hidden min-h-[240px] flex flex-col justify-end p-6 lg:p-8 border border-outline-variant shadow-sm">
          <div className="absolute inset-0 z-0">
            <div
              className="w-full h-full bg-cover bg-center"
              style={{ backgroundImage: `url(${DEFAULT_CLASS_BANNER_URL})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/90 to-primary/30 mix-blend-multiply" />
          </div>
          <div className="relative z-10 flex flex-col gap-2 max-w-3xl">
            <div>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-container/20 text-on-primary border border-on-primary/20 backdrop-blur-sm font-label-sm text-label-sm mb-4">
                <span className="material-symbols-outlined text-[14px]" aria-hidden>
                  public
                </span>
                Available to all students
              </span>
            </div>
            <h2 className="font-display text-display text-on-primary">{DEFAULT_CLASS_NAME}</h2>
            {displayDescription && (
              <p className="font-body-lg text-body-lg text-on-primary/80">{displayDescription}</p>
            )}
          </div>
        </div>
      ) : (
        <StudentClassHeader
          className={classDetail.className}
          cardImageUrl={classDetail.cardImageUrl}
          cardColorScheme={classDetail.cardColorScheme}
          description={displayDescription}
        />
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-outline-variant pb-2">
          <h3 className="font-headline-md text-headline-md text-primary">Simulations</h3>
          <span className="font-label-md text-label-md text-on-surface-variant">
            {simCount === 0
              ? "None available"
              : `${simCount} Available`}
          </span>
        </div>

        {simCount === 0 ? (
          isDefaultClass ? (
            <EmptyState
              icon=""
              materialIcon="rocket_launch"
              title="No Rehearse Essentials yet."
              description="Check back soon."
            />
          ) : (
            <EmptyState
              icon=""
              materialIcon="model_training"
              title="No simulations yet."
              description="Your professor hasn't assigned any published simulations to this class yet. Check back later."
            />
          )
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {classDetail.simulations.map((sim) => {
              const existing = attemptBySim.get(sim.id);
              const stagesCompleted = existing
                ? stageCountByAttempt.get(existing.id) ?? 0
                : 0;
              const query = new URLSearchParams({ classId: params.classId });
              if (existing) {
                query.set("attempt", existing.id);
              }

              const isTempoInDefaultClass =
                params.classId === DEFAULT_CLASS_ID &&
                isTempoDefaultSimulation(sim.id, sim.title);

              const href = isTempoInDefaultClass
                ? `/student/simulation/${sim.id}/entry?classId=${params.classId}`
                : `/student/simulation/${sim.id}?${query.toString()}`;

              // Match Tempo entry: blank lead_gen shells are not "started".
              const hasStarted = attemptHasStartedProgress({
                currentStage: existing?.current_stage,
                stageData: existing?.stage_data ?? null,
                stagesCompleted,
              });

              // Only what the card shows reaches the browser (no persona or its prompt).
              return (
                <SimulationCard
                  key={sim.id}
                  simulation={{ title: sim.title, description: sim.description, product_context: sim.product_context }}
                  accentColor={isDefaultClass ? "#00000b" : classDetail.accentColor}
                  actionLabel={hasStarted ? "Continue" : "Start Simulation"}
                  href={href}
                  stagesCompleted={hasStarted ? stagesCompleted : 0}
                  inProgress={hasStarted}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
