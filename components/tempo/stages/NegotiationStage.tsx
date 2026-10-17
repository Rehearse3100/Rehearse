/**
 * NegotiationStage.tsx
 * Stage 5 of the Tempo simulation — two sequential written negotiation scenarios.
 * Scenario A (Value Defense) must be completed before Scenario B unlocks.
 * Each scenario has 3 turns of written back-and-forth with Dr. Kim via GPT.
 * After both scenarios and AI work section, student can submit.
 * Only used in the Tempo/Default simulation.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { ReferenceLibraryDrawer } from "@/components/tempo/ReferenceLibraryDrawer";
import { TempoReferenceLibrary } from "@/components/tempo/TempoReferenceLibrary";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { NegotiationStageLayout } from "@/components/tempo/stages/NegotiationStageLayout";
import { NegotiationTopBar } from "@/components/tempo/stages/NegotiationTopBar";
import { useNegotiationStage } from "@/hooks/useNegotiationStage";
import { TEMPO_HANDOFF_MESSAGES, TEMPO_HANDOFF_STAGE_META } from "@/lib/tempo-prospecting";
import type { ReferenceLibraryData } from "@/lib/tempo-reference-library";

type NegotiationStageProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  /** Built by the server page for the shared Reference Library drawer. */
  referenceLibrary: ReferenceLibraryData;
  /** Server page boolean from TEMPO_TEST_BYPASS_GATES — never from client env. */
  testBypass?: boolean;
};

/**
 * Tempo Negotiation — two written scenarios, AI work, and final submission.
 */
export function NegotiationStage({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  referenceLibrary,
  testBypass = false,
}: NegotiationStageProps): React.ReactElement {
  const router = useRouter();
  const [showHandoff, setShowHandoff] = useState(false);
  const [referenceLibraryOpen, setReferenceLibraryOpen] = useState(false);
  const negotiation = useNegotiationStage({
    attemptId,
    simulationId,
    classId,
    testBypass,
  });
  const negotiationMeta = TEMPO_HANDOFF_STAGE_META.negotiation;

  if (negotiation.isLoading) {
    return (
      <>
        <TempoTestBypassBanner testBypass={testBypass} />
        <NegotiationTopBar
          attemptId={attemptId}
          simulationId={simulationId}
          classId={classId}
          simulationTitle={simulationTitle}
          onOpenHandoff={() => setShowHandoff(true)}
          onBackToDashboard={() =>
            router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
          }
          onOpenReferenceLibrary={() => setReferenceLibraryOpen(true)}
          isReferenceLibraryOpen={referenceLibraryOpen}
        />
        <div className="fixed inset-x-0 bottom-0 top-16 z-[45] flex items-center justify-center bg-surface">
          <p className="text-on-surface-variant font-body-md">Loading negotiation...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <TempoTestBypassBanner testBypass={testBypass} />
      <NegotiationTopBar
        attemptId={attemptId}
        simulationId={simulationId}
        classId={classId}
        simulationTitle={simulationTitle}
        onOpenHandoff={() => setShowHandoff(true)}
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
        onOpenReferenceLibrary={() => setReferenceLibraryOpen(true)}
        isReferenceLibraryOpen={referenceLibraryOpen}
      />

      <ErrorBoundary stageName="close">
        <NegotiationStageLayout
          activeScenario={negotiation.activeScenario}
          scenarioAState={negotiation.scenarioAState}
          scenarioBState={negotiation.scenarioBState}
          scenarioAData={negotiation.scenarioAData}
          scenarioBData={negotiation.scenarioBData}
          currentTurnIndex={negotiation.currentTurnIndex}
          currentResponse={negotiation.currentResponse}
          isLoadingTurn={negotiation.isLoadingTurn}
          isSubmitting={negotiation.isSubmitting}
          canSubmit={negotiation.canSubmit}
          aiWorkOpen={negotiation.aiWorkOpen}
          aiWork={negotiation.data.aiWork}
          testBypass={testBypass}
          onOpenHandoff={() => setShowHandoff(true)}
          onScenarioChange={negotiation.setActiveScenario}
          onResponseChange={negotiation.setCurrentResponse}
          onSendTurn={() => void negotiation.handleSendTurn()}
          onContinueToScenarioB={negotiation.handleContinueToScenarioB}
          onToggleAiWork={() => negotiation.setAiWorkOpen(!negotiation.aiWorkOpen)}
          onAiWorkChange={negotiation.setAiWork}
          onSaveDraft={negotiation.handleSaveDraft}
          onSubmit={() => void negotiation.handleSubmit()}
        />
      </ErrorBoundary>

      {showHandoff && (
        <HandoffModal
          stageNumber={negotiationMeta.stageNumber}
          stageName={negotiationMeta.stageName}
          stageIcon={negotiationMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.negotiation}
          hasAIRestriction={negotiationMeta.hasAIRestriction}
          onBegin={() => setShowHandoff(false)}
          onDismiss={() => setShowHandoff(false)}
          testBypass={testBypass}
        />
      )}

      <ReferenceLibraryDrawer
        open={referenceLibraryOpen}
        onClose={() => setReferenceLibraryOpen(false)}
        testBypass={testBypass}
      >
        <TempoReferenceLibrary data={referenceLibrary} />
      </ReferenceLibraryDrawer>
    </>
  );
}
