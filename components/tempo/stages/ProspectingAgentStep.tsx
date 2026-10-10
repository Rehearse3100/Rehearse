/**
 * ProspectingAgentStep.tsx
 * Final Prospecting wizard step — Build Your Agent, with manager note.
 * Stage Submit lives in wizard chrome; this step is non-blocking for Next.
 */

"use client";

import { MaterialIcon } from "@/components/ui/MaterialIcon";

type ProspectingAgentStepProps = {
  attemptId: string;
};

/**
 * Manager note + placeholder until the agent builder is implemented.
 */
export function ProspectingAgentStep({
  attemptId: _attemptId,
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

          <section className="p-gutter flex-1">
            <p className="font-body-md text-body-md text-on-surface-variant">
              This step is coming soon. Use{" "}
              <span className="font-medium text-on-surface">Submit</span> when you are ready to
              finish Prospecting.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
