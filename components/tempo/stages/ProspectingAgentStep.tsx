/**
 * ProspectingAgentStep.tsx
 * Final Prospecting wizard step — Build Your Agent, with manager note. Until the
 * agent builder exists, the student explains in one text box (styled like the ICP
 * form) how they would build the agent; it is saved as agentDesign on the wizard
 * draft, and stage Submit (in wizard chrome) needs AGENT_DESIGN_MIN_CHARS of it.
 */

"use client";

import { FieldCounter } from "@/components/tempo/FieldCounter";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { AGENT_DESIGN_MIN_CHARS, type ProspectingWizardState } from "@/lib/tempo-prospecting";

/** Longest agent explanation (a few paragraphs). */
const AGENT_DESIGN_MAX_LENGTH = 2000;

type ProspectingAgentStepProps = {
  attemptId: string;
  state: ProspectingWizardState;
  onFieldChange: <K extends keyof ProspectingWizardState>(
    key: K,
    value: ProspectingWizardState[K]
  ) => void;
};

/**
 * Manager note + the agent explanation box (stand-in until the agent builder is implemented).
 */
export function ProspectingAgentStep({
  attemptId: _attemptId,
  state,
  onFieldChange,
}: ProspectingAgentStepProps): React.ReactElement {
  return (
    <div className="bg-surface text-on-surface font-body-md min-h-full flex items-center justify-center p-gutter">
      <main className="w-full max-w-[800px] mx-auto space-y-lg">
        <div className="p-md bg-tertiary-fixed rounded-xl border border-tertiary-container/20">
          <div className="flex items-center gap-sm mb-xs text-on-tertiary-fixed">
            <MaterialIcon name="campaign" className="text-[18px]" />
            <span className="font-bold text-label-sm">Manager note</span>
          </div>
          <p className="text-label-sm text-[#584400] leading-relaxed">
            Nice work getting your outreach out the door. One last thing before your first call:
            show me how you would build a tool that does this prospecting for you.
          </p>
        </div>

        <article className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden flex flex-col">
          <header className="px-gutter pt-gutter pb-md border-b border-outline-variant/30 flex flex-col gap-sm">
            <h1 className="font-headline-lg text-headline-lg text-primary">
              Build Your Prospecting Agent
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-prose">
              You just researched accounts and shortlisted targets by hand. In this step you will
              design an AI system that can do that prospecting work for you, with the guardrails
              and judgment you built along the way.
            </p>
          </header>

          <section className="p-gutter flex-1 space-y-sm">
            <div className="flex justify-between items-center gap-md">
              <label className="font-bold text-label-md text-on-surface" htmlFor="agent-design">
                How would you build your prospecting agent?
              </label>
              <FieldCounter
                value={state.agentDesign}
                maxLength={AGENT_DESIGN_MAX_LENGTH}
                minChars={AGENT_DESIGN_MIN_CHARS}
              />
            </div>
            <p className="font-label-sm text-on-surface-variant">
              Explain what your agent would do, what it would look for, and how you would check
              its work.
            </p>
            <textarea
              id="agent-design"
              rows={8}
              maxLength={AGENT_DESIGN_MAX_LENGTH}
              className="w-full p-md bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary-container focus:border-secondary focus:outline-none font-body-md resize-y"
              placeholder="Type your answer"
              value={state.agentDesign}
              onChange={(e) => onFieldChange("agentDesign", e.target.value)}
            />
          </section>
        </article>
      </main>
    </div>
  );
}
