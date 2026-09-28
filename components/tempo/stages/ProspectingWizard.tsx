/**
 * ProspectingWizard.tsx
 * Stage 1 of the Tempo simulation — 6-step prospecting wizard (Welcome Briefing →
 * ICP → Data Room → Build Your Agent → Select Lead → Opening Message) with handoff.
 * Only rendered for Tempo in the Rehearse Essentials default class.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import { TempoWizardTopBar } from "@/components/tempo/TempoWizardTopBar";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { ProspectingStepPanels } from "@/components/tempo/stages/ProspectingStepPanels";
import { useProspectingWizard } from "@/hooks/useProspectingWizard";
import {
  isIcpDefinitionComplete,
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
  /** Server-reported TEMPO_TEST_BYPASS_GATES — never from client env. */
  gateBypassEnabled?: boolean;
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
  gateBypassEnabled = false,
}: ProspectingWizardProps): React.ReactElement {
  const router = useRouter();
  const wizard = useProspectingWizard({ attemptId, gateBypassEnabled });
  const [postSubmitHandoff, setPostSubmitHandoff] = useState<TempoHandoffStageKey | null>(
    initialDiscoveryHandoff ? "discovery" : null
  );
  const [forceHandoffOpen, setForceHandoffOpen] = useState(false);

  const { state } = wizard;
  const { currentStep } = state;
  const prospectingMeta = TEMPO_HANDOFF_STAGE_META.prospecting;
  const discoveryMeta = TEMPO_HANDOFF_STAGE_META.discovery;
  const icpComplete = isIcpDefinitionComplete(state);
  const showTestBypassBanner = wizard.gateBypassEnabled;
  const showProspectingHandoff =
    !wizard.isLoading &&
    !postSubmitHandoff &&
    (forceHandoffOpen || (!state.prospectingHandoffSeen && !icpComplete));

  if (wizard.isLoading) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-16 z-30 flex items-center justify-center bg-surface">
        <p className="text-on-surface-variant font-body-md">Loading your prospecting brief...</p>
      </div>
    );
  }

  const handleNext = async (): Promise<void> => {
    if (!wizard.canProceed || currentStep >= PROSPECTING_STEPS.length - 1) {
      return;
    }
    await wizard.handleStepAdvance(currentStep + 1);
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
      {showTestBypassBanner ? (
        <div
          className="fixed top-16 inset-x-0 z-[60] bg-amber-500 text-black px-4 py-2 text-center font-headline-md text-sm tracking-wide shadow-md"
          role="status"
        >
          TEST MODE: gates bypassed — do not treat this run as real student work
        </div>
      ) : null}

      <TempoWizardTopBar
        attemptId={attemptId}
        simulationId={simulationId}
        classId={classId}
        simulationTitle={simulationTitle}
        onOpenHandoff={() => setForceHandoffOpen(true)}
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
      />

      <div
        className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
          showTestBypassBanner ? "pt-28" : "pt-16"
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
              const isCompleted = index < currentStep;
              const isActive = index === currentStep;
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
            <div className="flex items-center gap-md text-on-surface-variant min-w-0">
              {currentStep > 0 ? (
                <button
                  type="button"
                  onClick={() => wizard.setCurrentStep(currentStep - 1)}
                  disabled={currentStep === 2 && !icpComplete}
                  className="inline-flex items-center gap-1 text-label-sm text-on-surface-variant hover:text-primary transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <MaterialIcon name="arrow_back" className="text-[16px]" />
                  Back to {PROSPECTING_STEPS[currentStep - 1]?.label ?? "previous step"}
                </button>
              ) : null}
              <div className="flex items-center gap-sm shrink-0">
                <MaterialIcon name="cloud_done" className="text-green-500" />
                <span className="text-label-sm">
                  {wizard.isSaving ? "Saving..." : "Auto-saved"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-md shrink-0">
                {currentStep === 0 ? (
                  <span
                    className={`hidden sm:inline text-label-sm ${
                      state.onboardingComplete ? "text-green-600" : "text-on-surface-variant"
                    }`}
                  >
                    {state.onboardingComplete
                      ? "Briefing complete, you can continue"
                      : "Watch the briefing to unlock Next"}
                  </span>
                ) : null}

                {currentStep > 0 && currentStep === PROSPECTING_STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => void wizard.handleSaveDraft()}
                    className="hidden sm:inline px-md py-sm rounded-lg text-on-surface-variant font-bold text-label-md hover:text-primary transition-colors"
                  >
                    Save Draft
                  </button>
                ) : null}

                {currentStep < PROSPECTING_STEPS.length - 1 ? (
                  <button
                    type="button"
                    disabled={!wizard.canProceed}
                    onClick={() => void handleNext()}
                    className={`px-lg py-sm rounded-lg font-bold text-label-md flex items-center gap-xs transition-all ${
                      wizard.canProceed
                        ? "bg-primary-container text-white hover:bg-primary shadow-md cursor-pointer"
                        : "bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed"
                    }`}
                  >
                    <span className="hidden sm:inline">
                      Next: {PROSPECTING_STEPS[currentStep + 1]?.label}
                    </span>
                    <span className="sm:hidden">Next</span>
                    <MaterialIcon name="arrow_forward" className="text-[18px]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!wizard.canSubmit || wizard.isSubmitting}
                    onClick={() => void handleSubmit()}
                    className={`px-lg py-sm rounded-lg text-label-md font-extrabold flex items-center gap-xs shadow-md transition-all ${
                      wizard.canSubmit && !wizard.isSubmitting
                        ? "bg-tertiary-fixed text-on-tertiary-fixed hover:brightness-95 active:scale-95 cursor-pointer"
                        : "bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed"
                    }`}
                  >
                    {wizard.isSubmitting ? "Submitting..." : "Submit Prospecting Brief"}
                    <MaterialIcon name="send" className="text-[18px]" />
                  </button>
                )}
              </div>
          </div>

          <div
            className={`flex-1 min-h-0 overflow-y-auto ${
              currentStep === 0 || currentStep === 1
                ? "p-0"
                : currentStep === 2
                  ? "p-2 lg:p-3"
                  : "p-4 lg:p-xl"
            }`}
          >
            <ProspectingStepPanels
              currentStep={currentStep}
              attemptId={attemptId}
              state={state}
              wordCount={wizard.wordCount}
              onSelectCompany={wizard.selectDirectoryCompany}
              onShortlistChange={wizard.setShortlistedCompanyIds}
              onFieldChange={wizard.updateField}
              onLeadSelected={(leadId) => wizard.completeLeadSelection(leadId)}
              onResearchContinue={() => void handleNext()}
              canResearchContinue={wizard.canProceed}
              onOnboardingComplete={wizard.completeOnboarding}
            />
          </div>
        </section>

        <aside className="w-64 bg-surface-container border-l border-outline-variant overflow-y-auto p-md hidden xl:block shrink-0">
          <div className="flex items-center justify-between mb-lg">
            <h3 className="font-headline-md text-headline-md">Reference Library</h3>
            <MaterialIcon name="library_books" className="text-on-surface-variant" />
          </div>
          <div className="space-y-lg">
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
            <div>
              <h4 className="font-label-sm text-on-surface-variant uppercase tracking-tighter mb-sm">
                Tempo Product
              </h4>
              <div className="bg-white rounded-lg border border-outline-variant p-md shadow-sm">
                <p className="text-label-sm leading-relaxed text-on-surface">
                  Scheduling software for appointment-based businesses. Core value: keep calendars
                  full and stop losing money to no-shows.
                </p>
              </div>
            </div>
            <div>
              <h4 className="font-label-sm text-on-surface-variant uppercase tracking-tighter mb-sm">
                Value Drivers
              </h4>
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
            </div>
            <div>
              <h4 className="font-label-sm text-on-surface-variant uppercase tracking-tighter mb-sm">
                Pricing
              </h4>
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
          </div>
        </aside>
        </div>
      </div>

      {showProspectingHandoff && (
        <HandoffModal
          stageNumber={prospectingMeta.stageNumber}
          stageName={prospectingMeta.stageName}
          stageIcon={prospectingMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.prospecting}
          hasAIRestriction={prospectingMeta.hasAIRestriction}
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
          onBegin={handleDiscoveryBegin}
          onDismiss={() => setPostSubmitHandoff(null)}
        />
      )}
    </>
  );
}
