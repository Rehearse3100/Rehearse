/**
 * PresentationStageLayout.tsx
 * Presentational shell for Tempo Stage 3 Presentation — mission panel and pitch form.
 * The Submit bar (save status left, Submit right) sits at the top of the center
 * column, matching ProspectingWizard; a center-only completion bar sits at the bottom.
 * The discovery reference lives in the Reference Library drawer (PresentationStage).
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import {
  isPresentationSectionComplete,
  PRESENTATION_PAYOFF_REFERENCE,
  type PresentationForm,
} from "@/lib/tempo-presentation";

/** Shared styling for student-editable fields — explicit border width so outlines render. */
const FORM_TEXTAREA =
  "w-full rounded-md border border-outline-variant bg-white text-body-md font-body-md text-on-surface placeholder:text-outline focus:border-secondary focus:ring-2 focus:ring-secondary/30 focus:ring-offset-0 focus:outline-none transition-shadow resize-y py-sm px-md";

const FORM_INPUT =
  "w-full h-10 rounded-md border border-outline-variant bg-white text-body-md font-body-md text-on-surface placeholder:text-outline focus:border-secondary focus:ring-2 focus:ring-secondary/30 focus:ring-offset-0 focus:outline-none transition-shadow px-md";

type PresentationStageLayoutProps = {
  form: PresentationForm;
  completedSections: number;
  canSubmit: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  onUpdateField: <K extends keyof PresentationForm>(key: K, value: PresentationForm[K]) => void;
  onSubmit: () => void;
  /** Extra top padding when TEST MODE banner is visible (matches Prospecting). */
  testBypass?: boolean;
};

/**
 * Renders the Presentation stage grid with a center-column completion bar.
 */
export function PresentationStageLayout({
  form,
  completedSections,
  canSubmit,
  isSaving,
  isSubmitting,
  onUpdateField,
  onSubmit,
  testBypass = false,
}: PresentationStageLayoutProps): React.ReactElement {
  const readyToSubmit = canSubmit;

  return (
    <div
      className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
        testBypass ? "pt-28" : "pt-16"
      }`}
    >
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left column: mission ─── */}
        <aside className="w-[280px] bg-[#1a1a2e] text-white flex flex-col p-6 overflow-y-auto border-r border-outline-variant shrink-0 hidden lg:flex">
          <div className="mb-6">
            <TempoExitSimulation />
          </div>
          <div className="mb-8">
            <span className="text-[11px] font-mono-label text-blue-300 uppercase tracking-[0.2em]">
              Current Phase
            </span>
            <h2 className="font-title-lg text-white mt-1">Stage 3: Presentation</h2>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="font-mono-label text-[12px] text-blue-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <MaterialIcon name="target" className="text-[16px]" />
                Your Mission
              </h3>
              <p className="text-body-md text-slate-300 leading-relaxed">
                Present the value of Tempo to{" "}
                <span className="text-white font-semibold">Dana Reyes</span> and{" "}
                <span className="text-white font-semibold">Dr. Saul Kim</span>. Your goal is to
                secure a pilot agreement.
              </p>
            </div>

            <div>
              <h3 className="font-mono-label text-[12px] text-blue-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <MaterialIcon name="groups" className="text-[16px]" />
                Your Audience
              </h3>
              <div className="space-y-3">
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-sm font-bold text-white">Dana Reyes</p>
                  <p className="text-[12px] text-slate-400">Operations / Clinic Staff</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-sm font-bold text-white">Dr. Saul Kim</p>
                  <p className="text-[12px] text-slate-400">Owner / Revenue & ROI</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Center column: Submit bar + form + completion bar ─── */}
        <section className="flex-1 bg-white flex flex-col min-w-0 min-h-0">
          <div className="h-12 bg-surface-container-low border-b border-outline-variant shrink-0 flex items-center justify-between px-4 lg:px-xl gap-4">
            <div className="flex items-center gap-sm text-on-surface-variant min-w-0 shrink-0">
              <MaterialIcon name="cloud_done" className="text-green-500" />
              <span className="text-label-sm">{isSaving ? "Saving..." : "Auto-saved"}</span>
            </div>

            <TempoStageForwardNav
              forwardLabel="Submit"
              forwardDisabled={!canSubmit || isSubmitting}
              isForwardLoading={isSubmitting}
              onForward={onSubmit}
              forwardHint={
                readyToSubmit ? null : "Finish all sections to submit."
              }
            />
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="max-w-4xl mx-auto py-8 lg:py-12 px-4 lg:px-12">
            <header className="flex flex-col gap-sm mb-base">
              <h1 className="text-display font-display text-primary">Present to Dana and Dr. Kim</h1>
              <p className="text-body-lg font-body-lg text-on-surface-variant">
                Construct your formal pitch narrative based on the discoveries made during previous
                stages.
              </p>
            </header>

            <div className="bg-surface-container-low border border-outline-variant rounded-lg p-md flex items-start gap-md shadow-sm mb-lg">
              <MaterialIcon name="lightbulb" className="text-secondary" filled />
              <p className="text-body-md font-body-md text-on-surface-variant flex-1">
                <span className="font-bold text-on-surface">Need a starting point?</span> Review the
                Discovery Summary, then construct your pitch narrative below.
              </p>
            </div>

            <form
              className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm flex flex-col p-lg gap-lg"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit && !isSubmitting) {
                  onSubmit();
                }
              }}
            >
              {/* Field 1: Business Issue */}
              <div className="flex flex-col gap-sm">
                <label
                  className="text-label-md font-label-md text-on-surface font-semibold flex items-center gap-2"
                  htmlFor="business-case"
                >
                  <MaterialIcon name="trending_down" className="text-on-surface-variant text-[18px]" />
                  Business Issue
                  {isPresentationSectionComplete(1, form) ? (
                    <MaterialIcon name="check_circle" className="text-green-600 text-[16px]" filled />
                  ) : null}
                </label>
                <textarea
                  id="business-case"
                  name="business-case"
                  rows={3}
                  className={FORM_TEXTAREA}
                  placeholder="Type your answer"
                  value={form.businessCase}
                  onChange={(e) => onUpdateField("businessCase", e.target.value)}
                />
              </div>

              <hr className="border-t border-outline-variant/30" />

              {/* Field 2: Problem */}
              <div className="flex flex-col gap-sm">
                <label
                  className="text-label-md font-label-md text-on-surface font-semibold flex items-center gap-2"
                  htmlFor="pain-points"
                >
                  <MaterialIcon name="report_problem" className="text-on-surface-variant text-[18px]" />
                  Problem
                  {isPresentationSectionComplete(2, form) ? (
                    <MaterialIcon name="check_circle" className="text-green-600 text-[16px]" filled />
                  ) : null}
                </label>
                <textarea
                  id="pain-points"
                  name="pain-points"
                  rows={3}
                  className={FORM_TEXTAREA}
                  placeholder="Type your answer"
                  value={form.underlyingPainPoints}
                  onChange={(e) => onUpdateField("underlyingPainPoints", e.target.value)}
                />
              </div>

              <hr className="border-t border-outline-variant/30" />

              {/* Field 3: Solution */}
              <div className="flex flex-col gap-sm">
                <label
                  className="text-label-md font-label-md text-on-surface font-semibold flex items-center gap-2"
                  htmlFor="solution"
                >
                  <MaterialIcon name="build" className="text-on-surface-variant text-[18px]" />
                  Solution
                  {isPresentationSectionComplete(3, form) ? (
                    <MaterialIcon name="check_circle" className="text-green-600 text-[16px]" filled />
                  ) : null}
                </label>
                <textarea
                  id="solution"
                  name="solution"
                  rows={4}
                  className={FORM_TEXTAREA}
                  placeholder="Type your answer"
                  value={form.solution}
                  onChange={(e) => onUpdateField("solution", e.target.value)}
                />
              </div>

              <hr className="border-t border-outline-variant/30" />

              {/* Field 4: Value */}
              <div className="flex flex-col gap-md">
                <label
                  className="text-label-md font-label-md text-on-surface font-semibold flex items-center gap-2"
                  htmlFor="proof-point"
                >
                  <MaterialIcon
                    name="monetization_on"
                    className="text-on-surface-variant text-[18px]"
                  />
                  Value
                  {isPresentationSectionComplete(4, form) ? (
                    <MaterialIcon name="check_circle" className="text-green-600 text-[16px]" filled />
                  ) : null}
                </label>
                <div className="bg-surface-container-low rounded-md border border-dashed border-outline-variant p-md flex items-center gap-md">
                  <MaterialIcon name="calculate" className="text-secondary shrink-0" />
                  <span className="font-code-md text-code-md text-on-surface-variant">
                    {PRESENTATION_PAYOFF_REFERENCE}
                  </span>
                </div>
                <div className="flex flex-col gap-sm mt-xs">
                  <span className="text-label-sm font-label-sm text-on-surface-variant">
                    Supporting Proof Point
                  </span>
                  <input
                    id="proof-point"
                    name="proof-point"
                    type="text"
                    className={FORM_INPUT}
                    placeholder="Type your answer"
                    value={form.proofPoint}
                    onChange={(e) => onUpdateField("proofPoint", e.target.value)}
                  />
                </div>
              </div>

              <hr className="border-t border-outline-variant/30" />

              {/* Field 5: Power */}
              <div className="flex flex-col gap-sm">
                <label
                  className="text-label-md font-label-md text-on-surface font-semibold flex items-center gap-2"
                  htmlFor="power-stakeholder"
                >
                  <MaterialIcon name="group" className="text-on-surface-variant text-[18px]" />
                  Power
                  {isPresentationSectionComplete(5, form) ? (
                    <MaterialIcon name="check_circle" className="text-green-600 text-[16px]" filled />
                  ) : null}
                </label>
                <textarea
                  id="power-stakeholder"
                  name="power-stakeholder"
                  rows={4}
                  className={FORM_TEXTAREA}
                  placeholder="Type your answer"
                  value={form.powerStakeholder}
                  onChange={(e) => onUpdateField("powerStakeholder", e.target.value)}
                />
              </div>

              <hr className="border-t border-outline-variant/30" />

              {/* Field 6: Plan */}
              <div className="flex flex-col gap-sm">
                <label
                  className="text-label-md font-label-md text-on-surface font-semibold flex items-center gap-2"
                  htmlFor="next-step"
                >
                  <MaterialIcon name="flag" className="text-on-surface-variant text-[18px]" />
                  Plan
                  {isPresentationSectionComplete(6, form) ? (
                    <MaterialIcon name="check_circle" className="text-green-600 text-[16px]" filled />
                  ) : null}
                </label>
                <input
                  id="next-step"
                  name="next-step"
                  type="text"
                  className={FORM_INPUT}
                  placeholder="Type your answer"
                  value={form.nextStep}
                  onChange={(e) => onUpdateField("nextStep", e.target.value)}
                />
              </div>
            </form>
            </div>
          </div>

          {/* Completion bar — center column only */}
          <footer className="shrink-0 min-h-[96px] bg-white border-t border-outline-variant flex items-center justify-between gap-4 px-4 lg:px-12 py-5 z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
            <div className="flex flex-col min-w-0 flex-1 max-w-md gap-2">
              <div className="flex justify-between items-end gap-3">
                <h3 className="font-mono-label text-[12px] text-on-surface-variant uppercase tracking-wider">
                  Progress
                </h3>
                <span className="text-[12px] font-mono-label text-on-surface">
                  {completedSections} / 6 Completed
                </span>
              </div>
              <div className="flex gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-full ${
                      i < completedSections
                        ? "bg-tertiary-container shadow-[0_0_8px_rgba(201,168,76,0.35)]"
                        : "bg-surface-container-high"
                    }`}
                  />
                ))}
              </div>
              <span className="text-[12px] text-on-surface-variant leading-snug">
                {readyToSubmit
                  ? "Great! You're ready to submit."
                  : "Finish all sections to submit."}
              </span>
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
