/**
 * PresentationStage.tsx
 * Stage 3 of the Tempo simulation — structured written pitch submission.
 * Student writes a tailored pitch outline using Discovery findings.
 * Six ValuePrompter-style fields in a 3-column layout.
 * Only used in the Tempo/Default simulation (Rehearse Essentials class).
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { PresentationStageLayout } from "@/components/tempo/stages/PresentationStageLayout";
import { PresentationTopBar } from "@/components/tempo/stages/PresentationTopBar";
import { usePresentationStage } from "@/hooks/usePresentationStage";
import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";
import {
  TEMPO_HANDOFF_MESSAGES,
  TEMPO_HANDOFF_STAGE_META,
} from "@/lib/tempo-prospecting";

type PresentationStageProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  discoverySummary: Partial<DiscoverySummaryForm>;
  /** Server page boolean from TEMPO_TEST_BYPASS_GATES — never from client env. */
  testBypass?: boolean;
};

/**
 * Tempo Presentation — structured pitch form with discovery reference panel.
 */
export function PresentationStage({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  discoverySummary,
  testBypass = false,
}: PresentationStageProps): React.ReactElement {
  const router = useRouter();
  const [showHandoff, setShowHandoff] = useState(false);
  const [showObjectionsHandoff, setShowObjectionsHandoff] = useState(false);
  const [openRefs, setOpenRefs] = useState<Set<string>>(() => new Set());

  const presentation = usePresentationStage({ attemptId, testBypass });

  const presentationMeta = TEMPO_HANDOFF_STAGE_META.presentation;
  const objectionsMeta = TEMPO_HANDOFF_STAGE_META.objections;

  const handleToggleRef = useCallback((label: string): void => {
    setOpenRefs((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

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
          onBackToDashboard={() =>
            router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
          }
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
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
      />

      <ErrorBoundary stageName="presentation">
        <PresentationStageLayout
          form={presentation.form}
          discoverySummary={discoverySummary}
          completedSections={presentation.completedSections}
          canSubmit={presentation.canSubmit}
          isSaving={presentation.isSaving}
          isSubmitting={presentation.isSubmitting}
          openRefs={openRefs}
          onToggleRef={handleToggleRef}
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
    </>
  );
}
