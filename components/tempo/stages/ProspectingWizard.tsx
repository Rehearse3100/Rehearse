/**
 * ProspectingWizard.tsx
 * Stage 1 of the Tempo simulation — 6-step prospecting wizard (Welcome Briefing →
 * ICP → Data Room → Select Lead → Opening Message → Build Your Agent) with handoff.
 * Only rendered for Tempo in the Rehearse Essentials default class.
 */

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import {
  ReferenceLibraryDrawer,
  ReferenceLibrarySectionLabel,
} from "@/components/tempo/ReferenceLibraryDrawer";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { TempoWizardTopBar } from "@/components/tempo/TempoWizardTopBar";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { ProspectingReadingList } from "@/components/tempo/stages/ProspectingOnboardingStep";
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

type ProspectingWizardProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
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
  initialDiscoveryHandoff = false,
  testBypass = false,
}: ProspectingWizardProps): React.ReactElement {
  const router = useRouter();
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
  const forwardDisabled = upcomingStepId
    ? currentStepId === "select_lead"
      ? !selectLeadCanProceed || isConfirmingLead
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
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
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
          <div className="px-lg h-12 flex items-center border-b border-white/10 shrink-0">
            <TempoExitSimulation />
          </div>
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
            <div className="flex items-center gap-sm text-on-surface-variant min-w-0 shrink-0">
              <MaterialIcon name="cloud_done" className="text-green-500" />
              <span className="text-label-sm">
                {wizard.isSaving ? "Saving..." : "Auto-saved"}
              </span>
            </div>

            <TempoStageForwardNav
              forwardLabel={upcomingStepId ? "Next" : "Submit"}
              forwardDisabled={forwardDisabled}
              isForwardLoading={!upcomingStepId && wizard.isSubmitting}
              onForward={() => {
                if (upcomingStepId) {
                  void handleNext();
                  return;
                }
                void handleSubmit();
              }}
              forwardHint={
                currentStepId === "onboarding"
                  ? state.onboardingComplete
                    ? "Briefing complete, you can continue"
                    : "Watch the briefing to unlock Next"
                  : currentStepId === "select_lead" && !selectLeadCanProceed
                    ? "Pick a lead to continue"
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
              actions={
                currentStepId === "opening" ? (
                  <button
                    type="button"
                    onClick={() => void wizard.handleSaveDraft()}
                    className="hidden sm:inline px-md py-sm rounded-lg text-on-surface-variant font-bold text-label-md hover:text-primary transition-colors"
                  >
                    Save Draft
                  </button>
                ) : null
              }
            />
          </div>

          <div
            className={`flex-1 min-h-0 overflow-y-auto ${
              currentStepId === "onboarding" || currentStepId === "icp"
                ? "p-0"
                : currentStepId === "research"
                  ? "p-2 lg:p-3"
                  : "p-4 lg:p-xl"
            }`}
          >
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
          </div>
        </section>
        </div>
      </div>

      <ReferenceLibraryDrawer
        open={referenceLibraryOpen}
        onClose={() => setReferenceLibraryOpen(false)}
        stageLabel="Stage 1: Prospecting"
        testBypass={testBypass}
      >
        <section>
          <ReferenceLibrarySectionLabel>Your ICP</ReferenceLibrarySectionLabel>
          <div className="space-y-3">
            {(
              [
                { label: "Target industry", value: state.icpTargetVerticals },
                { label: "Decision-maker role", value: state.icpDecisionMakerRole },
                {
                  label: "Size range",
                  value:
                    state.icpSizeMinLocations.trim() || state.icpSizeMaxLocations.trim()
                      ? `${state.icpSizeMinLocations.trim() || "—"} – ${state.icpSizeMaxLocations.trim() || "—"} locations`
                      : "",
                },
                {
                  label: "Operational signals that predict fit",
                  value: state.icpOperationalSignals,
                },
                { label: "Disqualifier 1", value: state.icpDisqualifier1 },
                { label: "Disqualifier 2", value: state.icpDisqualifier2 },
                { label: "Disqualifier 3 (optional)", value: state.icpDisqualifier3 },
              ] as const
            ).map((field) => (
              <div
                key={field.label}
                className="bg-white rounded-lg border border-outline-variant p-md shadow-sm"
              >
                <p className="font-bold text-label-sm text-on-surface mb-1">{field.label}</p>
                <p className="text-label-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap">
                  {field.value.trim() ? field.value : "Not filled in yet"}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <ReferenceLibrarySectionLabel>Reading List</ReferenceLibrarySectionLabel>
          <ProspectingReadingList />
        </section>

        <section>
          <ReferenceLibrarySectionLabel>Tempo Product</ReferenceLibrarySectionLabel>
          <div className="bg-white rounded-lg border border-outline-variant p-md shadow-sm">
            <p className="text-label-sm leading-relaxed text-on-surface">
              Scheduling software for appointment-based businesses. Core value: keep calendars
              full and stop losing money to no-shows.
            </p>
          </div>
        </section>

        <section>
          <ReferenceLibrarySectionLabel>Value Drivers</ReferenceLibrarySectionLabel>
          {[
            { icon: "trending_down", text: "Cut no-shows" },
            { icon: "desktop_windows", text: "Free the front desk" },
            { icon: "nightlight", text: "Capture after-hours demand" },
            { icon: "replay", text: "Drive repeat visits" },
          ].map((driver) => (
            <div
              key={driver.text}
              className="flex items-center gap-sm p-sm hover:bg-surface-container-low rounded-lg transition-colors"
            >
              <MaterialIcon name={driver.icon} className="text-secondary text-[18px]" />
              <span className="text-label-md text-on-surface">{driver.text}</span>
            </div>
          ))}
        </section>

        <section>
          <ReferenceLibrarySectionLabel>Pricing</ReferenceLibrarySectionLabel>
          <div className="bg-white rounded-lg border border-outline-variant p-md space-y-xs text-label-sm">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Starter</span>
              <span className="font-bold text-on-surface">$99/location/mo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Pro</span>
              <span className="font-bold text-on-surface">$179/location/mo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Annual</span>
              <span className="font-bold text-on-surface">~15% off</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Onboarding</span>
              <span className="font-bold text-on-surface">$500/location</span>
            </div>
          </div>
        </section>

        <div className="p-md bg-secondary-fixed rounded-xl border border-secondary-container/20">
          <div className="flex items-center gap-sm mb-xs text-on-secondary-fixed">
            <MaterialIcon name="lightbulb" className="text-[18px]" />
            <span className="font-bold text-label-sm">Rehearse Tips</span>
          </div>
          <p className="text-label-sm text-on-secondary-fixed/90 leading-relaxed">
            Focus on pain points rather than demographics. A customer&apos;s industry matters
            less than the specific problem they are trying to solve right now.
          </p>
        </div>

        <div className="p-md bg-tertiary-fixed rounded-xl border border-tertiary-container/20">
          <div className="flex items-center gap-sm mb-xs text-on-tertiary-fixed">
            <MaterialIcon name="lightbulb" className="text-[18px]" />
            <span className="font-bold text-label-sm">Rehearse Tips</span>
          </div>
          <p className="text-label-sm text-[#584400] leading-relaxed">
            Keep the opening message under 120 words. Lead with their business issue and a
            specific trigger to ensure a higher response rate.
          </p>
        </div>
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
