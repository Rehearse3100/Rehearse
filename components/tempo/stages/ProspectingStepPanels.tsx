/**
 * ProspectingStepPanels.tsx
 * Step content panels for the Tempo Stage 1 Prospecting wizard.
 * Steps: Welcome Briefing → ICP → Data Room → Build Your Agent → Select Lead → Opening.
 */

"use client";

import { ProspectingAgentStep } from "@/components/tempo/stages/ProspectingAgentStep";
import { ProspectingOnboardingStep } from "@/components/tempo/stages/ProspectingOnboardingStep";
import { ProspectingDataRoom } from "@/components/tempo/stages/ProspectingDataRoom";
import { ProspectingIcpStep } from "@/components/tempo/stages/ProspectingIcpStep";
import { ProspectingLeadSelectionStep } from "@/components/tempo/stages/ProspectingLeadSelectionStep";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import {
  OPENING_MESSAGE_TIPS,
  type ProspectingStepId,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

type StepPanelsProps = {
  currentStepId: ProspectingStepId;
  attemptId: string;
  state: ProspectingWizardState;
  wordCount: number;
  /** Server page boolean — never from client process.env. */
  testBypass?: boolean;
  onSelectCompany: (companyId: string) => void;
  onShortlistChange: (companyIds: string[]) => void;
  onFieldChange: <K extends keyof ProspectingWizardState>(
    key: K,
    value: ProspectingWizardState[K]
  ) => void;
  onLeadSelected: (leadId: string) => Promise<void>;
  onResearchContinue?: () => void;
  canResearchContinue?: boolean;
  onOnboardingComplete: () => void;
};

/**
 * Renders the active wizard step panel in the center column.
 */
export function ProspectingStepPanels({
  currentStepId,
  attemptId,
  state,
  wordCount,
  testBypass = false,
  onSelectCompany,
  onShortlistChange,
  onFieldChange,
  onLeadSelected,
  onResearchContinue,
  canResearchContinue = false,
  onOnboardingComplete,
}: StepPanelsProps): React.ReactElement {
  if (currentStepId === "onboarding") {
    return (
      <ProspectingOnboardingStep
        attemptId={attemptId}
        onboardingComplete={state.onboardingComplete}
        onOnboardingComplete={onOnboardingComplete}
        testBypass={testBypass}
      />
    );
  }

  if (currentStepId === "icp") {
    return (
      <ProspectingIcpStep attemptId={attemptId} state={state} onFieldChange={onFieldChange} />
    );
  }

  if (currentStepId === "research") {
    return (
      <ProspectingDataRoom
        attemptId={attemptId}
        selectedCompanyId={state.selectedCompanyId}
        onSelectCompany={onSelectCompany}
        onShortlistChange={onShortlistChange}
        onContinue={onResearchContinue}
        canContinue={canResearchContinue}
      />
    );
  }

  if (currentStepId === "agent") {
    return <ProspectingAgentStep attemptId={attemptId} />;
  }

  if (currentStepId === "select_lead") {
    return (
      <ProspectingLeadSelectionStep
        attemptId={attemptId}
        selectedLeadId={state.selectedLeadId}
        onSelected={onLeadSelected}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap gap-md mb-lg">
        {[
          {
            icon: "person",
            label: "Target",
            value: "Dana Reyes, Director of Operations",
            color: "text-secondary",
          },
          {
            icon: "bolt",
            label: "Trigger",
            value: "Summit 8th location expansion",
            color: "text-tertiary-container",
          },
          {
            icon: "domain",
            label: "Account",
            value: "Summit Dental Group",
            color: "text-on-surface-variant",
          },
        ].map((pill) => (
          <div
            key={pill.label}
            className="flex items-center gap-sm bg-surface-container-high px-md py-sm rounded-full border border-outline-variant"
          >
            <MaterialIcon name={pill.icon} className={`text-base ${pill.color}`} />
            <span className="text-label-md font-bold text-on-surface">{pill.label}:</span>
            <span className="text-label-md text-on-surface-variant">{pill.value}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden mb-lg">
        <div className="p-lg border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">Draft Your Opening</h2>
            <p className="text-body-md text-on-surface-variant">
              Personalize the outreach based on your research.
            </p>
          </div>
        </div>
        <div className="p-lg grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-lg items-start">
          <div className="relative min-w-0">
            <textarea
              className="w-full h-64 p-lg rounded-lg border border-outline focus:ring-2 focus:ring-secondary-container focus:border-secondary font-body-md text-body-lg resize-none leading-relaxed"
              placeholder="Write your opening message here..."
              value={state.openingMessage}
              onChange={(e) => onFieldChange("openingMessage", e.target.value)}
            />
            <div
              className={`absolute bottom-4 right-4 flex items-center gap-xs bg-white/90 px-sm py-xs rounded-md shadow-sm border ${
                wordCount > 120 ? "border-error" : "border-outline-variant"
              }`}
            >
              <span
                className={`text-label-sm font-bold ${
                  wordCount > 120 ? "text-error" : "text-tertiary-container"
                }`}
              >
                {wordCount}
              </span>
              <span className="text-[10px] uppercase text-on-surface-variant">Words</span>
              <div
                className={`h-2 w-2 rounded-full ${wordCount > 120 ? "bg-error" : "bg-green-500"}`}
              />
            </div>
          </div>

          <aside className="bg-surface-container-low p-md rounded-lg border border-outline-variant">
            <h4 className="text-label-md font-bold text-on-surface mb-md flex items-center gap-sm">
              <MaterialIcon name="lightbulb" className="text-tertiary-container" />
              Tips
            </h4>
            <ul className="space-y-sm">
              {OPENING_MESSAGE_TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-sm text-body-md text-on-surface-variant">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-tertiary-container shrink-0" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}
