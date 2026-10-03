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

  const { data: enrollment } = await supabase
    .from("student_classes")
    .select("id")
    .eq("student_id", session.studentId)
    .eq("class_id", classId)
    .single();

  if (!enrollment) {
    redirect("/student/dashboard");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("name")
    .eq("id", classId)
    .single();

  const { data: assignment } = await supabase
    .from("class_simulations")
    .select(
      `
      simulation_id,
      simulations (*)
    `
    )
    .eq("class_id", classId)
    .eq("simulation_id", params.id)
    .single();

  const simRaw = assignment?.simulations;
  const simulation = (Array.isArray(simRaw) ? simRaw[0] : simRaw) as Simulation | null;

  if (!simulation || !simulation.is_published) {
    redirect("/student/dashboard");
  }

  let attempt: Attempt | null = null;

  if (searchParams.attempt) {
    const { data } = await supabase
      .from("attempts")
      .select("*")
      .eq("id", searchParams.attempt)
      .eq("student_id", session.studentId)
      .eq("class_id", classId)
      .single();
    if (data && data.status !== "abandoned") {
      attempt = data as Attempt;
    }
  }

  if (!attempt) {
    const { data: existingRows } = await supabase
      .from("attempts")
      .select("*")
      .eq("simulation_id", params.id)
      .eq("student_id", session.studentId)
      .eq("class_id", classId)
      .eq("status", ATTEMPT_STATUS.IN_PROGRESS)
      .order("started_at", { ascending: false })
      .limit(20);

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

  const { data: stageScores } = await supabase
    .from("stage_scores")
    .select("*")
    .eq("attempt_id", attempt.id);

  const scores = (stageScores ?? []) as StageScore[];

  const { data: crmLogRows } = await supabase
    .from("crm_log_entries")
    .select("stage")
    .eq("attempt_id", attempt.id);

  const initialLoggedStages = (crmLogRows ?? []).map((row) => row.stage as string);
  const completedStages = scores.map((s) => s.stage);

  const hasProspectingScore = scores.some((s) => s.stage === "prospecting");
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

  // Ensure stale icpGateComplete flags never skip the ICP step.
  if (isTempoDefault) {
    const stageData =
      ((attempt as unknown as { stage_data?: Record<string, unknown> | null }).stage_data ??
        {}) as Record<string, unknown>;
    const icp = parseProspectingIcpState(stageData.icp);
    let nextStageData: Record<string, unknown> | null = null;

    if (testStageProspecting) {
      nextStageData = stripIcpFromStageData(stageData);
    } else if (icp?.feedbackSeen !== true && stageData.icpGateComplete === true) {
      nextStageData = { ...stageData, icpGateComplete: false };
    }

    if (nextStageData) {
      const { error: icpResetError } = await supabase
        .from("attempts")
        .update({ stage_data: nextStageData })
        .eq("id", attempt.id);
      if (!icpResetError) {
        attempt = {
          ...attempt,
          stage_data: nextStageData,
        } as unknown as Attempt;
      }
    }
  }

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
