/**
 * PresentationStageLayout.tsx
 * Presentational 3-column shell for Tempo Stage 3 Presentation —
 * mission panel, pitch form with center-only completion bar, and discovery reference.
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";
import {
  isPresentationSectionComplete,
  PRESENTATION_PAYOFF_REFERENCE,
  TEMPO_REFERENCE_SECTIONS,
  type PresentationForm,
} from "@/lib/tempo-presentation";

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

/** Shared styling for student-editable fields — explicit border width so outlines render. */
const FORM_TEXTAREA =
  "w-full rounded-md border border-outline-variant bg-white text-body-md font-body-md text-on-surface placeholder:text-outline focus:border-secondary focus:ring-2 focus:ring-secondary/30 focus:ring-offset-0 focus:outline-none transition-shadow resize-y py-sm px-md";

const FORM_INPUT =
  "w-full h-10 rounded-md border border-outline-variant bg-white text-body-md font-body-md text-on-surface placeholder:text-outline focus:border-secondary focus:ring-2 focus:ring-secondary/30 focus:ring-offset-0 focus:outline-none transition-shadow px-md";

type PresentationStageLayoutProps = {
  form: PresentationForm;
  discoverySummary: Partial<DiscoverySummaryForm>;
  completedSections: number;
  canSubmit: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  openRefs: ReadonlySet<string>;
  onToggleRef: (label: string) => void;
  onUpdateField: <K extends keyof PresentationForm>(key: K, value: PresentationForm[K]) => void;
  onSubmit: () => void;
};

/**
 * Renders the Presentation stage grid with a center-column completion bar.
 */
export function PresentationStageLayout({
  form,
  discoverySummary,
  completedSections,
  canSubmit,
  isSaving,
  isSubmitting,
  openRefs,
  onToggleRef,
  onUpdateField,
  onSubmit,
}: PresentationStageLayoutProps): React.ReactElement {
  const readyToSubmit = canSubmit;

  return (
    <div className="fixed inset-0 z-[45] flex flex-col pt-16 overflow-hidden bg-surface">
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

        {/* ── Center column: form + completion bar ─── */}
        <section className="flex-1 bg-white flex flex-col min-w-0 min-h-0">
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
                  placeholder="e.g., Summit Dental is losing $138,240/month due to an 18% no-show rate..."
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
                  placeholder="e.g., Front desk staff is overwhelmed by manual calls, leading to dropped follow-ups..."
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
                  placeholder="e.g., Automated reminders and self-service booking would directly reduce the no-show rate and free up front-desk time..."
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
                    placeholder="e.g., Similar clinics saw a 35% reduction in no-shows within 90 days..."
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
                  placeholder="Dr. Kim holds final approval on this decision — how will you speak directly to his concerns while still addressing Dana's day-to-day perspective?"
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
                  placeholder="e.g., Secure commitment for a 14-day pilot at one location..."
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

            <div className="flex items-center gap-3 shrink-0">
              {isSaving && (
                <span className="text-[12px] text-on-surface-variant hidden sm:inline">
                  Saving...
                </span>
              )}
              <button
                type="button"
                disabled={!canSubmit || isSubmitting}
                onClick={onSubmit}
                className={`h-11 px-5 rounded-md font-label-md text-label-md flex items-center justify-center gap-2 ${
                  canSubmit && !isSubmitting
                    ? "bg-primary-container text-on-primary hover:bg-primary transition-colors"
                    : "bg-outline-variant text-white opacity-50 cursor-not-allowed"
                }`}
              >
                {isSubmitting ? "Submitting..." : "Submit Presentation"}
                <MaterialIcon name="arrow_forward" className="text-[18px]" />
              </button>
            </div>
          </footer>
        </section>

        {/* ── Right column: reference ─── */}
        <aside className="w-[320px] bg-[#f2f4f6] flex flex-col border-l border-outline-variant overflow-hidden shrink-0 hidden xl:flex">
          <div className="p-5 border-b border-outline-variant bg-white/50 backdrop-blur shrink-0">
            <h3 className="font-bold text-on-surface flex items-center gap-2">
              <MaterialIcon name="menu_book" className="text-[20px]" />
              Reference Library
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar min-h-0">
            <div>
              <h3 className="font-bold text-on-surface flex items-center gap-2 mb-4">
                <MaterialIcon name="book" className="text-[20px]" />
                Tempo Reference
              </h3>
              <div className="space-y-2">
                {TEMPO_REFERENCE_SECTIONS.map((section) => {
                  const isOpen = openRefs.has(section.label);
                  return (
                    <div key={section.label}>
                      <button
                        type="button"
                        onClick={() => onToggleRef(section.label)}
                        className="w-full flex items-center justify-between p-3 bg-white/50 hover:bg-white rounded-lg border border-outline-variant transition-all"
                      >
                        <span className="text-[13px] font-medium">{section.label}</span>
                        <MaterialIcon
                          name={isOpen ? "expand_less" : "chevron_right"}
                          className="text-[18px]"
                        />
                      </button>
                      {isOpen && (
                        <div className="mt-1 p-3 bg-white rounded-lg border border-outline-variant space-y-1">
                          {section.content.map((line) => (
                            <p key={line} className="text-[12px] text-on-surface-variant">
                              • {line}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-outline-variant">
              <h3 className="font-bold text-on-surface flex items-center gap-2 mb-4">
                <MaterialIcon name="sticky_note_2" className="text-[20px]" />
                Discovery Summary
              </h3>
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
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
