/**
 * entry/page.tsx
 * Simulation entry page for the Tempo simulation.
 * Shown when a student clicks Start or Continue on the
 * Rehearse Essentials class card. Branches between fresh-start
 * and in-progress briefing layouts before the student enters a stage.
 * Only rendered for the Tempo simulation in the default class.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { TempoEntryFreshStart } from "@/components/tempo/TempoEntryFreshStart";
import { TempoEntryInProgress } from "@/components/tempo/TempoEntryInProgress";
import { DEFAULT_CLASS_ID } from "@/lib/constants";
import {
  buildTempoEntryCtaHref,
  getCurrentTempoStage,
  isTempoDefaultSimulation,
} from "@/lib/tempo-simulation";
import {
  attemptHasStartedProgress,
  pickPreferredInProgressAttempt,
} from "@/lib/attempt-progress";
import { getStudentSession } from "@/lib/student-session";
import { createServiceClient } from "@/lib/supabase/server";
import type { SimulationStage } from "@/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
  searchParams: { classId?: string; new?: string };
};

const IN_PROGRESS_STAGES: SimulationStage[] = [
  "prospecting",
  "discovery",
  "presentation",
  "objections",
  "close",
];

export const metadata: Metadata = {
  title: "Tempo Simulation — Rehearse",
};

/**
 * Loads Tempo entry data and renders the appropriate briefing layout.
 */
export default async function TempoSimulationEntryPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (!session) {
    redirect("/student-login");
  }

  const classId = searchParams.classId?.trim() ?? "";
  if (!classId || classId !== DEFAULT_CLASS_ID) {
    redirect("/student/dashboard");
  }

  const supabase = createServiceClient();

  const { data: simulation, error: simError } = await supabase
    .from("simulations")
    .select("id, title, persona_name, persona_role, product_context, is_published")
    .eq("id", params.id)
    .single();

  if (simError || !simulation || !simulation.is_published) {
    notFound();
  }

  if (!isTempoDefaultSimulation(simulation.id, simulation.title)) {
    redirect(`/student/simulation/${params.id}?classId=${classId}`);
  }

  const { data: enrollment } = await supabase
    .from("student_classes")
    .select("id")
    .eq("student_id", session.studentId)
    .eq("class_id", classId)
    .single();

  if (!enrollment) {
    redirect("/student/dashboard");
  }

  // Prefer an attempt that already has ICP/wizard progress over a blank newer shell.
  const { data: inProgressRows } = await supabase
    .from("attempts")
    .select("id, status, current_stage, total_score, stage_data, started_at")
    .eq("student_id", session.studentId)
    .eq("simulation_id", params.id)
    .eq("class_id", classId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(20);

  let inProgressAttempt = pickPreferredInProgressAttempt(inProgressRows);

  if (!inProgressAttempt && searchParams.new === "1") {
    const { data: created } = await supabase
      .from("attempts")
      .insert({
        student_id: session.studentId,
        class_id: classId,
        student_class_id: enrollment.id,
        simulation_id: params.id,
        current_stage: "lead_gen",
      })
      .select("id, status, current_stage, total_score, stage_data, started_at")
      .single();

    inProgressAttempt = created;
  }

  const currentStage = (inProgressAttempt?.current_stage as SimulationStage | undefined) ?? null;

  if (currentStage === "results" && inProgressAttempt) {
    redirect(
      `/student/simulation/${params.id}/complete?classId=${classId}&attempt=${inProgressAttempt.id}`
    );
  }

  const stageData = (inProgressAttempt?.stage_data ?? null) as Record<string, unknown> | null;
  const discoveryHandoffSeen = stageData?.discoveryHandoffSeen === true;
  const displayStage: SimulationStage | null =
    currentStage === "discovery" && !discoveryHandoffSeen ? "prospecting" : currentStage;

  const attemptId = inProgressAttempt?.id ?? null;
  const hasInProgressAttempt = !!inProgressAttempt;

  let completedStageKeys = new Set<string>();

  if (attemptId && hasInProgressAttempt) {
    const { data: stageScores } = await supabase
      .from("stage_scores")
      .select("stage")
      .eq("attempt_id", attemptId);

    completedStageKeys = new Set((stageScores ?? []).map((row) => row.stage as string));
  }

  if (displayStage === "prospecting" && currentStage === "discovery") {
    completedStageKeys.delete("prospecting");
  }

  const hasStartedStageOne = attemptHasStartedProgress({
    currentStage,
    stageData,
    stagesCompleted: completedStageKeys.size,
  });
  const isFreshStart =
    !inProgressAttempt ||
    currentStage === null ||
    (currentStage === "lead_gen" && !hasStartedStageOne);
  const isMidSimulation =
    !!inProgressAttempt &&
    !!currentStage &&
    (IN_PROGRESS_STAGES.includes(currentStage) ||
      (currentStage === "lead_gen" && hasStartedStageOne));

  // Resume the attempt that has progress (not a blank shell).
  const ctaHref = buildTempoEntryCtaHref(
    params.id,
    classId,
    attemptId,
    hasStartedStageOne || (hasInProgressAttempt && currentStage !== "lead_gen")
  );

  if (isFreshStart) {
    return <TempoEntryFreshStart classId={classId} ctaHref={ctaHref} />;
  }

  if (isMidSimulation && displayStage) {
    const currentTempoStage = getCurrentTempoStage(displayStage);
    const ctaLabel = currentTempoStage
      ? `Continue Stage ${currentTempoStage.number}: ${currentTempoStage.title}`
      : "Continue →";

    return (
      <TempoEntryInProgress
        classId={classId}
        simulationId={params.id}
        simulationTitle={simulation.title}
        ctaHref={ctaHref}
        ctaLabel={ctaLabel}
        currentStage={displayStage}
        completedStageKeys={completedStageKeys}
        restartAttemptId={attemptId}
      />
    );
  }

  return <TempoEntryFreshStart classId={classId} ctaHref={ctaHref} />;
}
