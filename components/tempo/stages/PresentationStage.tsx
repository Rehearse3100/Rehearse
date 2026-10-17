/**
 * PresentationStage.tsx
 * Stage 3 of the Tempo simulation — structured written pitch submission.
 * Student writes a tailored pitch using Discovery findings, as a six-slide deck
 * (PresentationStageLayout); each slide holds one ValueSelling field.
 * Only used in the Tempo/Default simulation (Rehearse Essentials class).
 */

"use client";

import { useCallback, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { ReferenceLibraryDrawer } from "@/components/tempo/ReferenceLibraryDrawer";
import { TempoReferenceLibrary } from "@/components/tempo/TempoReferenceLibrary";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { PresentationStageLayout } from "@/components/tempo/stages/PresentationStageLayout";
import { PresentationTopBar } from "@/components/tempo/stages/PresentationTopBar";
import { usePresentationStage } from "@/hooks/usePresentationStage";
import {
  TEMPO_HANDOFF_MESSAGES,
  TEMPO_HANDOFF_STAGE_META,
} from "@/lib/tempo-prospecting";
import type { ReferenceLibraryData } from "@/lib/tempo-reference-library";

type PresentationStageProps = {
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
 * Tempo Presentation — the slide-deck builder with the shared Reference Library.
 */
export function PresentationStage({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  referenceLibrary,
  testBypass = false,
}: PresentationStageProps): React.ReactElement {
  const [showHandoff, setShowHandoff] = useState(false);
  const [showObjectionsHandoff, setShowObjectionsHandoff] = useState(false);
  const [referenceLibraryOpen, setReferenceLibraryOpen] = useState(false);

  const presentation = usePresentationStage({ attemptId, testBypass });

  const presentationMeta = TEMPO_HANDOFF_STAGE_META.presentation;
  const objectionsMeta = TEMPO_HANDOFF_STAGE_META.objections;

  const handleSubmit = useCallback(async (): Promise<void> => {
    await presentation.handleSubmit();
    setShowObjectionsHandoff(true);
  }, [presentation]);

  const handleObjectionsBegin = (): void => {
    window.location.assign(
      `/student/simulation/${simulationId}?classId=${classId}&attempt=${attemptId}`
    );
  };

  if (presentation.isLoading) {
    return (
      <>
        <TempoTestBypassBanner testBypass={testBypass} />
        <PresentationTopBar
          attemptId={attemptId}
          simulationId={simulationId}
          classId={classId}
          simulationTitle={simulationTitle}
          onOpenHandoff={() => setShowHandoff(true)}
          onOpenReferenceLibrary={() => setReferenceLibraryOpen(true)}
          isReferenceLibraryOpen={referenceLibraryOpen}
        />
        <div className="fixed inset-x-0 bottom-0 top-16 z-[45] flex items-center justify-center bg-surface">
          <p className="text-on-surface-variant font-body-md">Loading your presentation...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <TempoTestBypassBanner testBypass={testBypass} />
      <PresentationTopBar
        attemptId={attemptId}
        simulationId={simulationId}
        classId={classId}
        simulationTitle={simulationTitle}
        onOpenHandoff={() => setShowHandoff(true)}
        onOpenReferenceLibrary={() => setReferenceLibraryOpen(true)}
        isReferenceLibraryOpen={referenceLibraryOpen}
      />

      <ErrorBoundary stageName="presentation">
        <PresentationStageLayout
          form={presentation.form}
          canSubmit={presentation.canSubmit}
          isSaving={presentation.isSaving}
          isSubmitting={presentation.isSubmitting}
          onUpdateField={presentation.updateField}
          onSubmit={() => void handleSubmit()}
          testBypass={testBypass}
        />
      </ErrorBoundary>

      {showObjectionsHandoff && (
        <HandoffModal
          stageNumber={objectionsMeta.stageNumber}
          stageName={objectionsMeta.stageName}
          stageIcon={objectionsMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.objections}
          hasAIRestriction={objectionsMeta.hasAIRestriction}
          onBegin={handleObjectionsBegin}
          onDismiss={() => setShowObjectionsHandoff(false)}
          testBypass={testBypass}
        />
      )}

      {showHandoff && !showObjectionsHandoff && (
        <HandoffModal
          stageNumber={presentationMeta.stageNumber}
          stageName={presentationMeta.stageName}
          stageIcon={presentationMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.presentation}
          hasAIRestriction={presentationMeta.hasAIRestriction}
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
        <TempoReferenceLibrary attemptId={attemptId} data={referenceLibrary} />
      </ReferenceLibraryDrawer>
    </>
  );
}
