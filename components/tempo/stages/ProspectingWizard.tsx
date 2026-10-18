/**
 * ProspectingWizard.tsx
 * Stage 1 of the Tempo simulation — 6-step prospecting wizard (Welcome Briefing →
 * ICP → Data Room → Select Lead → Opening Message → Build Your Agent) with handoff.
 * Next on the ICP step reviews the ICP (once) and shows the manager's note in place
 * of the form until Continue to research.
 * Only rendered for Tempo in the Rehearse Essentials default class.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { ReferenceLibraryDrawer } from "@/components/tempo/ReferenceLibraryDrawer";
import { TempoReferenceLibrary } from "@/components/tempo/TempoReferenceLibrary";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { TempoWizardTopBar } from "@/components/tempo/TempoWizardTopBar";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { IcpManagerNote } from "@/components/tempo/stages/ProspectingIcpStep";
import { ProspectingStepPanels } from "@/components/tempo/stages/ProspectingStepPanels";
import type { ProspectingLeadSelectionHandle } from "@/components/tempo/stages/ProspectingLeadSelectionStep";
import { useProspectingWizard } from "@/hooks/useProspectingWizard";
import {
  isIcpDefinitionComplete,
  nextProspectingStepId,
  prevProspectingStepId,
  prospectingStepIndex,
  PROSPECTING_STEPS,
  TEMPO_HANDOFF_MESSAGES,
  TEMPO_HANDOFF_STAGE_META,
  type TempoHandoffStageKey,
} from "@/lib/tempo-prospecting";
import { buildIcpRows, isIcpSubmitted, type ReferenceLibraryData } from "@/lib/tempo-reference-library";

type ProspectingWizardProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  /** Built by the server page; the ICP rows are replaced with the live form below. */
  referenceLibrary: ReferenceLibraryData;
  /** Re-show the Stage 2 handoff over Stage 1 after returning mid-handoff. */
  initialDiscoveryHandoff?: boolean;
  /**
   * Server page boolean from TEMPO_TEST_BYPASS_GATES — never read process.env here.
   * Drives the TEST MODE banner and every Prospecting gate short-circuit.
   */
  testBypass?: boolean;
};

/**
 * Full-screen three-column prospecting wizard shell, handoff modals, and navigation.
 */
export function ProspectingWizard({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  referenceLibrary,
  initialDiscoveryHandoff = false,
  testBypass = false,
}: ProspectingWizardProps): React.ReactElement {
  const wizard = useProspectingWizard({ attemptId, testBypass });
  const [postSubmitHandoff, setPostSubmitHandoff] = useState<TempoHandoffStageKey | null>(
    initialDiscoveryHandoff ? "discovery" : null
  );
  const [forceHandoffOpen, setForceHandoffOpen] = useState(false);
  const [referenceLibraryOpen, setReferenceLibraryOpen] = useState(false);
  const [pickedLeadId, setPickedLeadId] = useState<string | null>(null);
  const [isConfirmingLead, setIsConfirmingLead] = useState(false);
  const leadSelectionRef = useRef<ProspectingLeadSelectionHandle>(null);

  const { state } = wizard;
  const { currentStepId } = state;
  const currentStepIndex = prospectingStepIndex(currentStepId);
  const prospectingMeta = TEMPO_HANDOFF_STAGE_META.prospecting;
  const discoveryMeta = TEMPO_HANDOFF_STAGE_META.discovery;
  const icpComplete = isIcpDefinitionComplete(state);
  const previousStepId = prevProspectingStepId(currentStepId);
  const upcomingStepId = nextProspectingStepId(currentStepId);
  // Banner is driven by the SERVER PROP only — not by hook/API state.
  const showProspectingHandoff =
    !wizard.isLoading &&
    !postSubmitHandoff &&
    (forceHandoffOpen || (!state.prospectingHandoffSeen && !icpComplete));

  useEffect(() => {
    if (currentStepId === "select_lead") {
      setPickedLeadId(state.selectedLeadId);
    }
  }, [currentStepId, state.selectedLeadId]);

  const handleLeadPickedChange = useCallback((leadId: string | null): void => {
    setPickedLeadId(leadId);
  }, []);

  const selectLeadCanProceed =
    testBypass || Boolean(pickedLeadId ?? state.selectedLeadId);
  // The manager's note replaces the ICP form until Continue to research marks it seen.
  const isIcpNoteShowing =
    currentStepId === "icp" && wizard.icpNote !== null && !wizard.icpNote.feedbackSeen;
  const forwardDisabled = upcomingStepId
    ? currentStepId === "select_lead"
      ? !selectLeadCanProceed || isConfirmingLead
      : currentStepId === "icp"
        ? !wizard.canProceed || wizard.isContinuingIcp
        : !wizard.canProceed
    : !wizard.canSubmit || wizard.isSubmitting;

  if (wizard.isLoading) {
    return (
      <>
        <TempoTestBypassBanner testBypass={testBypass} />
        <div className="fixed inset-x-0 bottom-0 top-16 z-30 flex items-center justify-center bg-surface">
          <p className="text-on-surface-variant font-body-md">Loading your prospecting brief...</p>
        </div>
      </>
    );
  }

  const handleNext = async (): Promise<void> => {
    if (!upcomingStepId) {
      return;
    }

    if (currentStepId === "select_lead") {
      if (!selectLeadCanProceed || isConfirmingLead) {
        return;
      }
      if (testBypass) {
        const leadId = pickedLeadId ?? state.selectedLeadId;
        if (leadId) {
          await wizard.completeLeadSelection(leadId);
        }
      } else {
        setIsConfirmingLead(true);
        try {
          const ok = await leadSelectionRef.current?.confirmSelection();
          if (!ok) {
            return;
          }
        } finally {
          setIsConfirmingLead(false);
        }
      }
      await wizard.handleStepAdvance(upcomingStepId);
      return;
    }

    if (!wizard.canProceed) {
      return;
    }
    if (currentStepId === "icp") {
      // Review the ICP and show the note (once), or move on when it's been seen.
      await wizard.advanceFromIcp();
      return;
    }
    await wizard.handleStepAdvance(upcomingStepId);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!wizard.canSubmit || wizard.isSubmitting) {
      return;
    }
    await wizard.handleSubmit();
    setPostSubmitHandoff("discovery");
    setForceHandoffOpen(false);
  };

  const handleDiscoveryBegin = async (): Promise<void> => {
    // Record the acknowledgement so re-entering the sim does not re-show
    // the gated Discovery handoff (student already clicked Begin Stage 2).
    try {
      await fetch("/api/student/discovery-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
        keepalive: true,
      });
    } catch {
      // Non-fatal: the Discovery page will just re-show the handoff.
    }
    window.location.assign(
      `/student/simulation/${simulationId}?classId=${classId}&attempt=${attemptId}`
    );
  };

  return (
    <>
      <TempoTestBypassBanner testBypass={testBypass} />

      <TempoWizardTopBar
        attemptId={attemptId}
        simulationId={simulationId}
        classId={classId}
        simulationTitle={simulationTitle}
        onOpenHandoff={() => setForceHandoffOpen(true)}
        onOpenReferenceLibrary={() => setReferenceLibraryOpen(true)}
        isReferenceLibraryOpen={referenceLibraryOpen}
      />

      <div
        className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
          testBypass ? "pt-28" : "pt-16"
        }`}
      >
        <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-60 bg-primary-container text-on-primary-container flex flex-col h-full shrink-0 hidden lg:flex">
          <div className="p-lg border-b border-white/10">
            <div className="flex items-center gap-2 mb-sm flex-nowrap">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#c6c4df] whitespace-nowrap shrink-0">
                Project Status
              </span>
              <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[9px] font-bold whitespace-nowrap shrink-0">
                IN PROGRESS
              </span>
            </div>
            <h2 className="text-headline-md font-bold text-white leading-tight">
              Stage 1: Prospecting
            </h2>
          </div>

          <nav className="flex-1 p-md mt-md overflow-y-auto">
            {PROSPECTING_STEPS.map((step, index) => {
              const isCompleted = currentStepIndex >= 0 && index < currentStepIndex;
              const isActive = step.id === currentStepId;
              return (
                <div key={step.id} className="flex gap-md">
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className={`z-10 w-6 h-6 rounded-full flex items-center justify-center font-code-md shrink-0 text-xs ${
                        isCompleted
                          ? "bg-tertiary-container text-on-tertiary-fixed"
                          : isActive
                            ? "bg-secondary-container text-on-secondary-container shadow-sm ring-4 ring-secondary-container/20"
                            : "border-2 border-white/30 text-white/50"
                      }`}
                    >
                      {isCompleted ? (
                        <MaterialIcon name="check" className="text-[14px]" />
                      ) : (
                        index
                      )}
                    </div>
                    {index < PROSPECTING_STEPS.length - 1 && (
                      <div
                        className={`w-0.5 h-12 mt-2 mb-1 shrink-0 ${
                          isCompleted ? "bg-tertiary-container" : "bg-outline-variant/40"
                        }`}
                      />
                    )}
                  </div>
                  <div className={`pt-0.5 min-w-0 ${index < PROSPECTING_STEPS.length - 1 ? "pb-5" : ""}`}>
                    <h3
                      className={`font-label-md text-label-md ${
                        isActive ? "text-white font-bold" : "text-on-primary-container"
                      }`}
                    >
                      {step.label}
                    </h3>
                    <p
                      className={`text-label-sm ${
                        isActive
                          ? "text-secondary font-medium"
                          : isCompleted
                            ? "text-on-primary-container/70"
                            : "text-on-primary-container/50"
                      }`}
                    >
                      {isCompleted ? "Completed" : isActive ? "In Progress" : "Not Started"}
                    </p>
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <section className="flex-1 bg-surface-container-lowest flex flex-col min-w-0">
          <div className="h-12 bg-surface-container-low border-b border-outline-variant shrink-0 flex items-center justify-between px-4 lg:px-xl gap-4">
            {currentStepId === "research" ? (
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-label-md font-semibold text-on-surface truncate">
                  Shortlist 3 companies that fit your ICP
                </span>
                {/* Plain status text (not a pill), so it doesn't read as a button. */}
                <span className="shrink-0 text-[12px] text-on-surface-variant">
                  · {state.shortlistedCompanyIds.length} of 3 shortlisted
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-sm text-on-surface-variant min-w-0 shrink-0">
                <MaterialIcon name="cloud_done" className="text-green-500" />
                <span className="text-label-sm">
                  {wizard.isSaving ? "Saving..." : "Auto-saved"}
                </span>
              </div>
            )}

            <TempoStageForwardNav
              forwardLabel={upcomingStepId ? "Next" : "Submit"}
              forwardDisabled={forwardDisabled}
              isForwardLoading={
                (!upcomingStepId && wizard.isSubmitting) || (currentStepId === "icp" && wizard.isReviewingIcp)
              }
              loadingLabel={currentStepId === "icp" ? "Reviewing your ICP…" : undefined}
              onForward={() => {
                if (upcomingStepId) {
                  void handleNext();
                  return;
                }
                void handleSubmit();
              }}
              forwardHint={
                currentStepId === "icp" && wizard.icpReviewError
                  ? wizard.icpReviewError
                  : currentStepId === "onboarding"
                  ? state.onboardingComplete
                    ? "Briefing complete, you can continue"
                    : "Watch the briefing to unlock Next"
                  : currentStepId === "select_lead" && !selectLeadCanProceed
                    ? "Pick a lead to continue"
                    : currentStepId === "agent" && !wizard.canProceed
                      ? "Explain your agent to submit"
                      : null
              }
              onBack={
                previousStepId
                  ? () => wizard.setCurrentStepId(previousStepId)
                  : undefined
              }
              backDisabled={currentStepId === "research" && !icpComplete}
              backLabel={
                previousStepId
                  ? `Back to ${
                      PROSPECTING_STEPS.find((step) => step.id === previousStepId)?.label ??
                      "previous step"
                    }`
                  : "Back"
              }
            />
          </div>

          <div
            className={`flex-1 min-h-0 overflow-y-auto ${
              currentStepId === "onboarding" ||
              currentStepId === "icp" ||
              currentStepId === "research"
                ? "p-0"
                : "p-4 lg:p-xl"
            }`}
          >
            {isIcpNoteShowing && wizard.icpNote ? (
              <IcpManagerNote
                note={wizard.icpNote.note}
                onContinue={() => void wizard.continueFromIcpNote()}
                isContinuing={wizard.isContinuingIcp}
              />
            ) : (
              <ProspectingStepPanels
                currentStepId={currentStepId}
                attemptId={attemptId}
                state={state}
                wordCount={wizard.wordCount}
                testBypass={testBypass}
                onSelectCompany={wizard.selectDirectoryCompany}
                onShortlistChange={wizard.setShortlistedCompanyIds}
                onFieldChange={wizard.updateField}
                leadSelectionRef={leadSelectionRef}
                onLeadPickedChange={handleLeadPickedChange}
                onLeadSelected={(leadId) => wizard.completeLeadSelection(leadId)}
                onOnboardingComplete={wizard.completeOnboarding}
              />
            )}
          </div>
        </section>
        </div>
      </div>

      <ReferenceLibraryDrawer
        open={referenceLibraryOpen}
        onClose={() => setReferenceLibraryOpen(false)}
        testBypass={testBypass}
      >
        {/* Live ICP once submitted (past the ICP step); locked before that. The
            manager's note shows as soon as it exists, including one just written. */}
        <TempoReferenceLibrary
          attemptId={attemptId}
          data={{
            ...referenceLibrary,
            icpRows: isIcpSubmitted(state.currentStepId, referenceLibrary.icpRows !== null)
              ? buildIcpRows(state)
              : null,
            icpNote: wizard.icpNote?.note.trim() || referenceLibrary.icpNote,
          }}
        />
      </ReferenceLibraryDrawer>

      {showProspectingHandoff && (
        <HandoffModal
          stageNumber={prospectingMeta.stageNumber}
          stageName={prospectingMeta.stageName}
          stageIcon={prospectingMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.prospecting}
          hasAIRestriction={prospectingMeta.hasAIRestriction}
          testBypass={testBypass}
          onBegin={() => {
            wizard.dismissProspectingHandoff();
            setForceHandoffOpen(false);
          }}
          onDismiss={() => {
            wizard.dismissProspectingHandoff();
            setForceHandoffOpen(false);
          }}
        />
      )}

      {postSubmitHandoff === "discovery" && (
        <HandoffModal
          stageNumber={discoveryMeta.stageNumber}
          stageName={discoveryMeta.stageName}
          stageIcon={discoveryMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.discovery}
          hasAIRestriction={discoveryMeta.hasAIRestriction}
          testBypass={testBypass}
          onBegin={handleDiscoveryBegin}
          onDismiss={() => setPostSubmitHandoff(null)}
        />
      )}
    </>
  );
}
