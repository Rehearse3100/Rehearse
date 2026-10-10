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
import {
  ReferenceLibraryDrawer,
  ReferenceLibrarySectionLabel,
} from "@/components/tempo/ReferenceLibraryDrawer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { NegotiationStageLayout } from "@/components/tempo/stages/NegotiationStageLayout";
import { NegotiationTopBar } from "@/components/tempo/stages/NegotiationTopBar";
import { useNegotiationStage } from "@/hooks/useNegotiationStage";
import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";
import type { ObjectionSummaryForm } from "@/lib/tempo-objections";
import type { PresentationForm } from "@/lib/tempo-presentation";
import {
  buildNegotiationPriorContext,
  TRADEABLE_LEVERS,
} from "@/lib/tempo-negotiation";
import { TEMPO_HANDOFF_MESSAGES, TEMPO_HANDOFF_STAGE_META } from "@/lib/tempo-prospecting";

type NegotiationStageProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  discoverySummary: Partial<DiscoverySummaryForm> | null;
  presentationSummary: Partial<PresentationForm> | null;
  objectionSummary: Partial<ObjectionSummaryForm> | null;
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
  discoverySummary,
  presentationSummary,
  objectionSummary,
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
  const priorContextSections = buildNegotiationPriorContext(
    discoverySummary,
    presentationSummary,
    objectionSummary
  );

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
        stageLabel="Stage 5: Negotiation"
        testBypass={testBypass}
      >
        <section className="space-y-4">
          <ReferenceLibrarySectionLabel>Tradeable Levers</ReferenceLibrarySectionLabel>
          <div className="overflow-hidden rounded-lg border border-outline-variant">
            <table className="w-full text-xs">
              <thead className="bg-surface-container-highest text-on-surface-variant font-bold">
                <tr>
                  <th className="text-left p-3">Lever</th>
                  <th className="text-left p-3">Give</th>
                  <th className="text-left p-3">Get</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant bg-white">
                {TRADEABLE_LEVERS.map((row) => (
                  <tr key={row.lever}>
                    <td className="p-3 font-medium">{row.lever}</td>
                    <td className="p-3 text-error">{row.give}</td>
                    <td className="p-3 text-green-600">{row.get}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="bg-tertiary-fixed text-on-tertiary-fixed p-4 rounded-xl shadow-sm border border-tertiary-container">
            <div className="flex items-center gap-2 mb-2 font-bold text-sm">
              <MaterialIcon name="payments" className="text-[18px]" />
              Deal Math Check
            </div>
            <div className="space-y-2 text-xs opacity-90">
              <div className="flex justify-between">
                <span>Pro × 8 locations annual:</span>
                <span className="font-bold">~$14,600/yr</span>
              </div>
              <div className="flex justify-between">
                <span>Monthly per location:</span>
                <span className="font-bold">$179/mo</span>
              </div>
              <div className="pt-2 mt-2 border-t border-on-tertiary-fixed/10 font-bold text-[11px]">
                Kim&apos;s true priority: certainty it works, not raw price
              </div>
            </div>
          </div>
        </section>

        <section>
          <ReferenceLibrarySectionLabel>Persona</ReferenceLibrarySectionLabel>
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center font-bold text-on-secondary-container">
                SK
              </div>
              <div>
                <p className="font-bold text-body-md">Dr. Saul Kim</p>
                <p className="text-xs text-on-surface-variant">Founder & Owner</p>
              </div>
            </div>
            <p className="text-body-md italic text-on-surface-variant mb-3">
              &ldquo;I value precision and long-term sustainability over quick discounts.&rdquo;
            </p>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed text-[10px] rounded uppercase font-bold">
                Analytical
              </span>
              <span className="px-2 py-1 bg-secondary-fixed text-on-secondary-fixed text-[10px] rounded uppercase font-bold">
                Tough
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <ReferenceLibrarySectionLabel>Prior Context</ReferenceLibrarySectionLabel>
            <p className="text-[12px] text-on-surface-variant">
              Your work from Stages 2–4, or Tempo simulation reference if a stage was skipped.
            </p>
          </div>

          {priorContextSections.map((section) => (
            <div key={section.stageLabel} className="space-y-3">
              <p className="text-mono-label text-[11px] font-bold uppercase text-on-surface-variant">
                {section.stageLabel}
              </p>
              {section.items.map((item) => (
                <div
                  key={`${section.stageLabel}-${item.label}`}
                  className={`p-3 bg-surface-container-high rounded-lg border-l-4 ${section.borderClass}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-mono-label text-[11px]">{item.label}</p>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        item.fromStudent
                          ? "bg-primary-container/10 text-primary"
                          : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      {item.fromStudent ? "Your work" : "Reference"}
                    </span>
                  </div>
                  <p className="text-body-md text-on-surface leading-relaxed whitespace-pre-wrap">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </section>
      </ReferenceLibraryDrawer>
    </>
  );
}
