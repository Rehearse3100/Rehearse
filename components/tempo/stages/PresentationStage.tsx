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
import {
  ReferenceLibraryDrawer,
  ReferenceLibrarySectionLabel,
} from "@/components/tempo/ReferenceLibraryDrawer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { PresentationStageLayout } from "@/components/tempo/stages/PresentationStageLayout";
import { PresentationTopBar } from "@/components/tempo/stages/PresentationTopBar";
import { usePresentationStage } from "@/hooks/usePresentationStage";
import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";
import { TEMPO_REFERENCE_SECTIONS } from "@/lib/tempo-presentation";
import {
  TEMPO_HANDOFF_MESSAGES,
  TEMPO_HANDOFF_STAGE_META,
} from "@/lib/tempo-prospecting";

const DISCOVERY_SUMMARY_ITEMS: {
  label: string;
  field: keyof DiscoverySummaryForm;
}[] = [
  { label: "Business Issue", field: "businessIssue" },
  { label: "Key Problems", field: "keyProblems" },
  { label: "Quantified Value", field: "quantifiedValue" },
  { label: "Personal Value", field: "personalValue" },
  { label: "Agreed Next Step", field: "nextStep" },
];

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
  const [referenceLibraryOpen, setReferenceLibraryOpen] = useState(false);
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
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
        onOpenReferenceLibrary={() => setReferenceLibraryOpen(true)}
        isReferenceLibraryOpen={referenceLibraryOpen}
      />

      <ErrorBoundary stageName="presentation">
        <PresentationStageLayout
          form={presentation.form}
          completedSections={presentation.completedSections}
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
        stageLabel="Stage 3: Presentation"
        testBypass={testBypass}
      >
        <section>
          <ReferenceLibrarySectionLabel>Tempo Reference</ReferenceLibrarySectionLabel>
          <div className="space-y-2">
            {TEMPO_REFERENCE_SECTIONS.map((section) => {
              const isOpen = openRefs.has(section.label);
              return (
                <div key={section.label}>
                  <button
                    type="button"
                    onClick={() => handleToggleRef(section.label)}
                    className="w-full flex items-center justify-between p-3 bg-white/50 hover:bg-white rounded-lg border border-outline-variant transition-all"
                  >
                    <span className="text-[13px] font-medium">{section.label}</span>
                    <MaterialIcon
                      name={isOpen ? "expand_less" : "chevron_right"}
                      className="text-[18px]"
                    />
                  </button>
                  {isOpen ? (
                    <div className="mt-1 p-3 bg-white rounded-lg border border-outline-variant space-y-1">
                      {section.content.map((line) => (
                        <p key={line} className="text-[12px] text-on-surface-variant">
                          • {line}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <ReferenceLibrarySectionLabel>Your Discovery Summary</ReferenceLibrarySectionLabel>
          <div className="space-y-4">
            {DISCOVERY_SUMMARY_ITEMS.map((item) => (
              <div
                key={item.field}
                className="p-3 bg-white border border-outline-variant rounded-lg shadow-sm"
              >
                <p className="text-[10px] font-mono-label text-primary-container uppercase mb-1">
                  {item.label}
                </p>
                <p className="text-sm font-medium text-on-surface">
                  {discoverySummary[item.field]?.trim() ? (
                    discoverySummary[item.field]
                  ) : (
                    <span className="text-on-surface-variant italic font-normal">
                      Not captured in Discovery
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      </ReferenceLibraryDrawer>
    </>
  );
}
