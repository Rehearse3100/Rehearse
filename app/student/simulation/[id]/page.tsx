/**
 * simulation/[id]/page.tsx — student
 * Starts or resumes an attempt and renders SimulationRunner.
 */

import { redirect } from "next/navigation";
import { CrmAccess } from "@/components/crm/CrmOverlay";
import { DiscoveryStage } from "@/components/tempo/stages/DiscoveryStage";
import { NegotiationStage } from "@/components/tempo/stages/NegotiationStage";
import { ObjectionHandlingStage } from "@/components/tempo/stages/ObjectionHandlingStage";
import { PresentationStage } from "@/components/tempo/stages/PresentationStage";
import { ProspectingWizard } from "@/components/tempo/stages/ProspectingWizard";
import { SimulationRunner } from "@/components/SimulationRunner";
import { ATTEMPT_STATUS, DEFAULT_CLASS_ID } from "@/lib/constants";
import { pickPreferredInProgressAttempt } from "@/lib/attempt-progress";
import { parseDiscoverySummaryFromTranscript, parsePresentationFormFromTranscript } from "@/lib/tempo-presentation";
import { parseObjectionSummaryFromTranscript } from "@/lib/tempo-negotiation";
import { parseProspectingIcpState } from "@/lib/tempo-icp-criteria";
import { stripIcpFromStageData } from "@/lib/tempo-prospecting";
import { isTempoDefaultSimulation } from "@/lib/tempo-simulation";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";
import { getStudentSession } from "@/lib/student-session";
import { createServiceClient } from "@/lib/supabase/server";
import type { Attempt, Simulation, StageScore } from "@/types";

type PageProps = {
  params: { id: string };
  searchParams: { attempt?: string; classId?: string; teststage?: string };
};

/**
 * Student simulation session page — uses class-assigned simulations only.
 */
export default async function StudentSimulationPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (!session) {
    redirect("/student-login");
  }

  const classId = searchParams.classId?.trim();
  if (!classId) {
    redirect("/student/dashboard");
  }

  const supabase = createServiceClient();

  /** In-progress attempts for this student, class, and simulation (newest first, max 20). */
  const searchInProgressAttempts = async (): Promise<unknown[] | null> => {
    const { data } = await supabase
      .from("attempts")
      .select("*")
      .eq("simulation_id", params.id)
      .eq("student_id", session.studentId)
      .eq("class_id", classId)
      .eq("status", ATTEMPT_STATUS.IN_PROGRESS)
      .order("started_at", { ascending: false })
      .limit(20);
    return data;
  };

  // ── Batch 1: independent reads, run together ───
  // Reads only; nothing is acted on until the redirect checks below pass, in
  // the same order as before. The attempt read is by id when ?attempt= is set,
  // otherwise the in-progress search.
  const [
    { data: enrollment },
    { data: classRow },
    { data: assignment },
    attemptByIdResult,
    inProgressRows,
  ] = await Promise.all([
    supabase
      .from("student_classes")
      .select("id")
      .eq("student_id", session.studentId)
      .eq("class_id", classId)
      .single(),
    supabase.from("classes").select("name").eq("id", classId).single(),
    supabase
      .from("class_simulations")
      .select(
        `
      simulation_id,
      simulations (*)
    `
      )
      .eq("class_id", classId)
      .eq("simulation_id", params.id)
      .single(),
    searchParams.attempt
      ? supabase
          .from("attempts")
          .select("*")
          .eq("id", searchParams.attempt)
          .eq("student_id", session.studentId)
          .eq("class_id", classId)
          .single()
      : null,
    searchParams.attempt ? null : searchInProgressAttempts(),
  ]);

  if (!enrollment) {
    redirect("/student/dashboard");
  }

  const simRaw = assignment?.simulations;
  const simulation = (Array.isArray(simRaw) ? simRaw[0] : simRaw) as Simulation | null;

  if (!simulation || !simulation.is_published) {
    redirect("/student/dashboard");
  }

  let attempt: Attempt | null = null;

  if (searchParams.attempt) {
    const data = attemptByIdResult?.data;
    if (data && data.status !== "abandoned") {
      attempt = data as Attempt;
    }
  }

  if (!attempt) {
    // Batch 1 already searched when ?attempt= was not set; otherwise search now, as before.
    const existingRows = searchParams.attempt ? await searchInProgressAttempts() : inProgressRows;

    const existing = pickPreferredInProgressAttempt(
      (existingRows ?? []) as Array<{
        current_stage?: string | null;
        stage_data?: unknown;
        started_at?: string | null;
      }>
    );

    if (existing) {
      attempt = existing as Attempt;
    } else {
      const { data: created } = await supabase
        .from("attempts")
        .insert({
          student_id: session.studentId,
          class_id: classId,
          student_class_id: enrollment.id,
          simulation_id: params.id,
          current_stage: "lead_gen",
        })
        .select()
        .single();
      attempt = created as Attempt;
    }
  }

  if (!attempt) {
    redirect("/student/dashboard");
  }

  if (attempt.status === "completed" || attempt.current_stage === "results") {
    redirect(`/student/simulation/${params.id}/complete?attempt=${attempt.id}`);
  }

  const isTempoDefault =
    classId === DEFAULT_CLASS_ID && isTempoDefaultSimulation(simulation.id, simulation.title);
  // Dev shortcuts for testing individual Tempo stages — exclusive when set.
  const rawTestStage = searchParams.teststage?.trim() ?? "";
  const testStageProspecting = rawTestStage === "prospecting";
  const testStageDiscovery = rawTestStage === "discovery";
  const testStagePresentation = rawTestStage === "presentation";
  const testStageObjections = rawTestStage === "objections";
  const testStageNegotiation = rawTestStage === "negotiation" || rawTestStage === "close";
  const hasTestStageJump =
    testStageProspecting ||
    testStageDiscovery ||
    testStagePresentation ||
    testStageObjections ||
    testStageNegotiation;
  // Local-dev Tempo gate bypass (all 5 stages) — single helper, pass as prop.
  // Never NEXT_PUBLIC_; client code must never read this env var.
  const testBypass = isGateBypassEnabled();

  // Ensure stale icpGateComplete flags never skip the ICP step. Decided here;
  // written in Batch 2 alongside the reads.
  let nextStageData: Record<string, unknown> | null = null;
  if (isTempoDefault) {
    const stageData =
      ((attempt as unknown as { stage_data?: Record<string, unknown> | null }).stage_data ??
        {}) as Record<string, unknown>;
    const icp = parseProspectingIcpState(stageData.icp);

    if (testStageProspecting) {
      nextStageData = stripIcpFromStageData(stageData);
    } else if (icp?.feedbackSeen !== true && stageData.icpGateComplete === true) {
      nextStageData = { ...stageData, icpGateComplete: false };
    }
  }

  // ── Batch 2: this attempt's reads and the ICP reset, run together ───
  const [{ data: stageScores }, { data: crmLogRows }, icpResetResult] = await Promise.all([
    supabase.from("stage_scores").select("*").eq("attempt_id", attempt.id),
    supabase.from("crm_log_entries").select("stage").eq("attempt_id", attempt.id),
    nextStageData
      ? supabase.from("attempts").update({ stage_data: nextStageData }).eq("id", attempt.id)
      : null,
  ]);

  // Same as before: apply the in-memory update only when the reset was written.
  if (nextStageData && icpResetResult && !icpResetResult.error) {
    attempt = {
      ...attempt,
      stage_data: nextStageData,
    } as unknown as Attempt;
  }

  const scores = (stageScores ?? []) as StageScore[];
  const initialLoggedStages = (crmLogRows ?? []).map((row) => row.stage as string);
  const completedStages = scores.map((s) => s.stage);
  const hasProspectingScore = scores.some((s) => s.stage === "prospecting");

  // Completing Stage 1 advances current_stage immediately, but Stage 2 should
  // not render until the student explicitly accepts its manager handoff.
  const attemptStageData =
    ((attempt as unknown as { stage_data?: Record<string, unknown> | null }).stage_data ??
      {}) as Record<string, unknown>;
  const discoveryHandoffSeen = attemptStageData.discoveryHandoffSeen === true;
  const isDiscoveryHandoffPending =
    attempt.current_stage === "discovery" && !discoveryHandoffSeen;

  const showTempoProspectingWizard =
    isTempoDefault &&
    (testStageProspecting ||
      (!hasTestStageJump && isDiscoveryHandoffPending) ||
      (!hasTestStageJump &&
        !hasProspectingScore &&
        (attempt.current_stage === "lead_gen" || attempt.current_stage === "prospecting")));

  const showTempoDiscovery =
    isTempoDefault &&
    (testStageDiscovery ||
      (!hasTestStageJump &&
        attempt.current_stage === "discovery" &&
        discoveryHandoffSeen));

  const discoveryScore = scores.find((s) => s.stage === "discovery");
  const discoverySummary = parseDiscoverySummaryFromTranscript(discoveryScore?.transcript);

  const showTempoPresentation =
    isTempoDefault &&
    (testStagePresentation || (!hasTestStageJump && attempt.current_stage === "presentation"));

  const presentationScore = scores.find((s) => s.stage === "presentation");
  const presentationSummary = parsePresentationFormFromTranscript(presentationScore?.transcript);

  const showTempoObjections =
    isTempoDefault &&
    (testStageObjections || (!hasTestStageJump && attempt.current_stage === "objections"));

  const showTempoNegotiation =
    isTempoDefault &&
    (testStageNegotiation || (!hasTestStageJump && attempt.current_stage === "close"));

  const objectionScore = scores.find((s) => s.stage === "objections");
  const objectionSummary = parseObjectionSummaryFromTranscript(objectionScore?.transcript);

  let stageView: React.ReactElement;

  if (showTempoProspectingWizard) {
    stageView = (
      <ProspectingWizard
        attemptId={attempt.id}
        simulationId={simulation.id}
        classId={classId}
        simulationTitle={simulation.title}
        initialDiscoveryHandoff={!hasTestStageJump && isDiscoveryHandoffPending}
        testBypass={testBypass}
      />
    );
  } else if (showTempoDiscovery) {
    stageView = (
      <DiscoveryStage
        attemptId={attempt.id}
        simulationId={simulation.id}
        classId={classId}
        simulationTitle={simulation.title}
        initialShowHandoff={!discoveryHandoffSeen}
        resetStoredPrep={testStageDiscovery}
        testBypass={testBypass}
      />
    );
  } else if (showTempoPresentation) {
    stageView = (
      <PresentationStage
        attemptId={attempt.id}
        simulationId={simulation.id}
        classId={classId}
        simulationTitle={simulation.title}
        discoverySummary={discoverySummary}
        testBypass={testBypass}
      />
    );
  } else if (showTempoObjections) {
    stageView = (
      <ObjectionHandlingStage
        attemptId={attempt.id}
        simulationId={simulation.id}
        classId={classId}
        simulationTitle={simulation.title}
        presentationSummary={presentationSummary}
        testBypass={testBypass}
      />
    );
  } else if (showTempoNegotiation) {
    stageView = (
      <NegotiationStage
        attemptId={attempt.id}
        simulationId={simulation.id}
        classId={classId}
        simulationTitle={simulation.title}
        discoverySummary={discoverySummary}
        presentationSummary={presentationSummary}
        objectionSummary={objectionSummary}
        testBypass={testBypass}
      />
    );
  } else {
    stageView = (
      <SimulationRunner
        simulation={simulation}
        attempt={attempt}
        stageScores={scores}
        classId={classId}
        className={classRow?.name}
      />
    );
  }

  if (!isTempoDefault) {
    return stageView;
  }

  return (
    <CrmAccess
      simulationId={simulation.id}
      classId={classId}
      attemptId={attempt.id}
      currentStage={attempt.current_stage}
      displayName={session.displayName}
      completedStages={completedStages}
      initialLoggedStages={initialLoggedStages}
      testBypass={testBypass}
    >
      {stageView}
    </CrmAccess>
  );
}
