/**
 * HandoffModal.tsx
 * Manager handoff modal for Tempo simulation stages.
 * Overlays the page with blur backdrop; student must click Begin Stage to proceed.
 * Schema-driven CRM hard gate: stages after Discovery that have a log schema
 * require a CRM log for the just-completed stage. Lead conversion is automatic
 * on Prospecting completion — Discovery is not gated on a manual Convert click.
 */

"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useTempoCrmGate } from "@/components/crm/CrmOverlay";
import {
  justCompletedStageForHandoff,
  stageRequiresCrmLog,
} from "@/lib/tempo-crm-fields";

export type HandoffModalProps = {
  stageNumber: number;
  stageName: string;
  stageIcon: string;
  message: string;
  hasAIRestriction: boolean;
  onBegin: () => void;
  onDismiss: () => void;
  /** Override: stage that must be CRM-logged before Begin (defaults from stageNumber). */
  justCompletedStage?: string | null;
  /** Override: whether a CRM log already exists for that stage. */
  crmLogExists?: boolean;
  /** Override: open CRM deep-linked to the stage that needs logging. */
  onOpenCrmForStage?: (stage: string) => void;
  /**
   * Server page boolean from TEMPO_TEST_BYPASS_GATES — never from client process.env.
   * Short-circuits the CRM Account/Contact Begin Stage 2 gate when true.
   */
  testBypass?: boolean;
};

/**
 * Renders the manager handoff overlay with entry animation and optional CRM gate.
 */
export function HandoffModal({
  stageNumber,
  stageName,
  stageIcon,
  message,
  hasAIRestriction,
  onBegin,
  onDismiss,
  justCompletedStage: justCompletedProp,
  crmLogExists: crmLogExistsProp,
  onOpenCrmForStage: onOpenCrmProp,
  testBypass = false,
}: HandoffModalProps): React.ReactElement {
  const [entered, setEntered] = useState(false);
  const gate = useTempoCrmGate();
  const {
    noteCompletedStage,
    loggedStages,
    openCrmForStage,
    openCrmHome,
    prospectingCrmComplete,
    testBypass: contextTestBypass,
  } = gate;
  // Prefer explicit prop from ProspectingWizard; fall back to CrmAccess context.
  const bypassActive = testBypass || contextTestBypass;

  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 100);
    return () => window.clearTimeout(timer);
  }, []);

  const inferredCompleted = justCompletedStageForHandoff(stageNumber);
  const justCompleted =
    justCompletedProp !== undefined ? justCompletedProp : inferredCompleted;

  const requiresLog =
    typeof justCompleted === "string" && stageRequiresCrmLog(justCompleted);

  const crmLogExists =
    crmLogExistsProp !== undefined
      ? crmLogExistsProp
      : justCompleted
        ? loggedStages.has(justCompleted)
        : true;

  const isGated = requiresLog && !crmLogExists;
  const showAccountNudge = !isGated && justCompleted === "prospecting";
  // Stage 2 gate: Account + primary Contact required fields must be complete.
  // bypassActive short-circuits only; existing prospectingCrmComplete check stays intact.
  const isProfileGated = showAccountNudge && !prospectingCrmComplete && !bypassActive;

  useEffect(() => {
    if (isGated && justCompleted) {
      noteCompletedStage(justCompleted);
    }
  }, [isGated, justCompleted, noteCompletedStage]);

  const handleOpenCrm = (): void => {
    if (!justCompleted) {
      return;
    }
    if (onOpenCrmProp) {
      onOpenCrmProp(justCompleted);
      return;
    }
    openCrmForStage(justCompleted);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-overlay animate-overlay-in"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        className={`bg-surface-container-lowest w-full max-w-[560px] rounded-xl shadow-xl overflow-hidden border border-outline-variant transition-all duration-300 ${
          entered ? "animate-modal-in" : "opacity-0 scale-95 translate-y-2"
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-modal-title"
      >
        <div className="px-4 py-2 flex justify-between items-center bg-primary-container">
          <span className="font-code-md text-[10px] tracking-widest text-on-primary uppercase">
            MESSAGE FROM YOUR MANAGER
          </span>
          <span className="font-code-md text-[10px] tracking-widest text-on-primary uppercase">
            Stage {stageNumber} of 5
          </span>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center font-headline-md bg-secondary-fixed text-on-secondary-fixed">
              AT
            </div>
            <div>
              <h2 id="handoff-modal-title" className="font-headline-md text-on-surface">
                Alex Torres
              </h2>
              <p className="font-label-sm text-on-surface-variant">Senior Sales Manager</p>
            </div>
          </div>

          <div className="bg-surface-container-low p-4 rounded-r-lg border-l-4 border-tertiary-container">
            <p className="font-body-lg text-on-surface leading-relaxed italic">{message}</p>
          </div>

          <div className="bg-secondary-fixed/10 border border-secondary-fixed/20 p-4 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-secondary-fixed/20 rounded-lg flex items-center justify-center shrink-0">
                <MaterialIcon name={stageIcon} className="text-secondary" />
              </div>
              <div className="min-w-0">
                <p className="font-label-sm text-secondary uppercase tracking-tight">Up next</p>
                <h3 className="font-headline-md text-on-surface">
                  Stage {stageNumber}: {stageName}
                </h3>
              </div>
            </div>
            {!hasAIRestriction ? (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 rounded-full shrink-0">
                <div className="w-1.5 h-1.5 bg-green-600 rounded-full" />
                <span className="text-[11px] font-bold text-green-700 uppercase">
                  No AI restrictions
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 rounded-full shrink-0">
                <div className="w-1.5 h-1.5 bg-amber-600 rounded-full" />
                <span className="text-[11px] font-bold text-amber-800 uppercase">No AI on call</span>
              </div>
            )}
          </div>

          <div className="pt-2 space-y-3">
            {isGated ? (
              <>
                <p className="text-body-md text-on-surface-variant text-center">
                  Fill out your CRM log for this stage before continuing.
                </p>
                <button
                  type="button"
                  onClick={handleOpenCrm}
                  className="w-full h-12 rounded-lg font-headline-md flex items-center justify-center gap-2 bg-[#0f4c4c] text-white font-bold hover:brightness-110 transition-all active:scale-[0.98]"
                >
                  <MaterialIcon name="hub" />
                  Log in CRM to Continue
                </button>
                <button
                  type="button"
                  disabled
                  className="w-full h-12 rounded-lg font-headline-md flex items-center justify-center gap-2 bg-outline-variant text-on-surface-variant font-bold opacity-50 cursor-not-allowed"
                  aria-disabled="true"
                >
                  Begin Stage {stageNumber}
                  <MaterialIcon name="arrow_forward" />
                </button>
              </>
            ) : (
              <>
                {isProfileGated ? (
                  <p className="text-body-md text-on-surface-variant text-center">
                    Your Account and Contact records still have required fields to fill in.
                    Complete them in the CRM before starting Stage {stageNumber}.
                  </p>
                ) : null}
                <div className={showAccountNudge ? "grid gap-3 sm:grid-cols-2" : ""}>
                  {showAccountNudge ? (
                    <button
                      type="button"
                      onClick={openCrmHome}
                      className="w-full min-h-12 px-3 py-2 rounded-lg flex items-center justify-center gap-2 bg-[#0f4c4c] text-white text-[13px] leading-tight font-bold hover:brightness-110 transition-all active:scale-[0.98]"
                    >
                      <MaterialIcon name="business_center" />
                      Go to CRM: Add Account &amp; Contact Notes
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onBegin}
                    disabled={isProfileGated}
                    aria-disabled={isProfileGated}
                    className={`w-full min-h-12 rounded-lg font-headline-md flex items-center justify-center gap-2 font-bold transition-all ${
                      isProfileGated
                        ? "bg-outline-variant text-on-surface-variant opacity-50 cursor-not-allowed"
                        : "bg-primary-container text-white hover:bg-primary active:scale-[0.98]"
                    }`}
                  >
                    Begin Stage {stageNumber}
                    <MaterialIcon name="arrow_forward" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="h-1 bg-gradient-to-r from-tertiary-container via-secondary-fixed to-secondary-container opacity-50" />
      </div>
    </div>
  );
}
