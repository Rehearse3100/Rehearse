/**
 * simulations/page.tsx — student
 * Ongoing + completed simulation attempts.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  StudentAttemptHistory,
  type StudentAttemptRow,
} from "@/components/StudentAttemptHistory";
import {
  StudentOngoingSimulations,
  type StudentOngoingRow,
} from "@/components/StudentOngoingSimulations";
import { RefreshOnMount } from "@/components/student/RefreshOnMount";
import { ATTEMPT_STATUS, DEFAULT_CLASS_ID } from "@/lib/constants";
import {
  attemptHasStartedProgress,
  pickPreferredInProgressAttempt,
} from "@/lib/attempt-progress";
import { isTempoDefaultSimulation } from "@/lib/tempo-simulation";
import { getStudentSession } from "@/lib/student-session";
import { createServiceClient } from "@/lib/supabase/server";
import type { SimulationStage } from "@/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Simulations — Rehearse",
};

type AttemptSimJoin = {
  id: string;
  title: string;
  product_context?: string;
} | null;

type AttemptClassJoin = {
  id: string;
  name: string;
} | null;

type OngoingAttemptRow = {
  id: string;
  class_id: string | null;
  current_stage: SimulationStage | null;
  stage_data: unknown;
  simulation_id: string | null;
  started_at: string | null;
  simulations: AttemptSimJoin | AttemptSimJoin[] | null;
  classes: AttemptClassJoin | AttemptClassJoin[] | null;
};

/**
 * Student simulations tab — ongoing runs and completed history.
 */
export default async function StudentSimulationsPage(): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (!session) {
    redirect("/student-login");
  }

  const supabase = createServiceClient();

  const [{ data: ongoingRows }, { data: completedAttempts }] = await Promise.all([
    supabase
      .from("attempts")
      .select(
        "id, class_id, current_stage, stage_data, simulation_id, started_at, simulations ( id, title, product_context ), classes ( id, name )"
      )
      .eq("student_id", session.studentId)
      .eq("status", ATTEMPT_STATUS.IN_PROGRESS)
      .order("started_at", { ascending: false }),
    supabase
      .from("attempts")
      // No persona name: it can give away the right contact.
      .select("id, total_score, completed_at, simulations ( id, title )")
      .eq("student_id", session.studentId)
      .eq("status", ATTEMPT_STATUS.COMPLETED)
      .order("completed_at", { ascending: false })
      .limit(20),
  ]);

  // One card per simulation+class: prefer the attempt with real progress (ICP etc.).
  const grouped = new Map<string, OngoingAttemptRow[]>();
  for (const row of (ongoingRows ?? []) as OngoingAttemptRow[]) {
    const key = `${row.class_id ?? ""}:${row.simulation_id ?? ""}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const preferredOngoing = Array.from(grouped.values())
    .map((list) => pickPreferredInProgressAttempt(list))
    .filter((row): row is OngoingAttemptRow => row != null)
    .filter((row) =>
      attemptHasStartedProgress({
        currentStage: row.current_stage,
        stageData: row.stage_data,
      })
    );

  const attemptIds = preferredOngoing.map((row) => row.id);
  const stageCountByAttempt = new Map<string, number>();
  if (attemptIds.length > 0) {
    const { data: stageRows } = await supabase
      .from("stage_scores")
      .select("attempt_id")
      .in("attempt_id", attemptIds);

    for (const row of stageRows ?? []) {
      const id = row.attempt_id as string;
      stageCountByAttempt.set(id, (stageCountByAttempt.get(id) ?? 0) + 1);
    }
  }

  const ongoing: StudentOngoingRow[] = preferredOngoing.map((row) => {
    const simRaw = row.simulations;
    const sim = (Array.isArray(simRaw) ? simRaw[0] ?? null : simRaw) as AttemptSimJoin;
    const classRaw = row.classes;
    const cls = (Array.isArray(classRaw) ? classRaw[0] ?? null : classRaw) as AttemptClassJoin;
    const classId = row.class_id ?? "";
    const simulationId = row.simulation_id ?? sim?.id ?? "";
    const title = sim?.title ?? "Simulation";
    const isTempo =
      classId === DEFAULT_CLASS_ID && isTempoDefaultSimulation(simulationId, title);

    const continueHref = isTempo
      ? `/student/simulation/${simulationId}/entry?classId=${classId}`
      : `/student/simulation/${simulationId}?classId=${classId}&attempt=${row.id}`;

    return {
      attemptId: row.id,
      simulationId,
      title,
      className: cls?.name ?? null,
      stagesCompleted: stageCountByAttempt.get(row.id) ?? 0,
      continueHref,
    };
  });

  const history: StudentAttemptRow[] = (completedAttempts ?? []).map((row) => {
    const sim = row.simulations;
    const simulation = Array.isArray(sim) ? sim[0] ?? null : sim;
    return {
      id: row.id as string,
      total_score: row.total_score as number,
      completed_at: row.completed_at as string | null,
      simulations: simulation as StudentAttemptRow["simulations"],
    };
  });

  return (
    <div className="animate-fade-in-up">
      <RefreshOnMount />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 space-y-10">
        <header>
          <h1 className="font-display text-display text-on-surface">My Simulations</h1>
          <p className="text-on-surface-variant font-body-md mt-1">
            Pick up where you left off, or review scores from completed runs.
          </p>
        </header>

        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-outline-variant pb-2">
            <h2 className="font-headline-md text-headline-md text-primary">Ongoing</h2>
            <span className="font-label-md text-label-md text-on-surface-variant">
              {ongoing.length === 0
                ? "None"
                : `${ongoing.length} in progress`}
            </span>
          </div>
          <StudentOngoingSimulations attempts={ongoing} />
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-outline-variant pb-2">
            <h2 className="font-headline-md text-headline-md text-primary">Completed</h2>
            <span className="font-label-md text-label-md text-on-surface-variant">
              {history.length === 0
                ? "None"
                : `${history.length} shown`}
            </span>
          </div>
          <StudentAttemptHistory attempts={history} />
        </section>
      </div>
    </div>
  );
}
