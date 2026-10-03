/**
 * NegotiationStageLayout.tsx
 * Presentational 3-column shell for Tempo Stage 5 Negotiation —
 * mission panel, written exchange workspace, reference library, and footer.
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";
import type { ObjectionSummaryForm } from "@/lib/tempo-objections";
import type { PresentationForm } from "@/lib/tempo-presentation";
import {
  buildNegotiationPriorContext,
  getOutcomeStatusLabel,
  NEGOTIATION_MIN_WORDS,
  NEGOTIATION_STRATEGY_TIPS,
  TRADEABLE_LEVERS,
  wordCount,
  type NegotiationAiWork,
  type NegotiationOutcome,
  type NegotiationScenario,
  type NegotiationScenarioData,
  type NegotiationTurn,
  type ScenarioState,
} from "@/lib/tempo-negotiation";

type NegotiationStageLayoutProps = {
  activeScenario: NegotiationScenario;
  scenarioAState: ScenarioState;
  scenarioBState: ScenarioState;
  scenarioAData: NegotiationScenarioData;
  scenarioBData: NegotiationScenarioData;
  currentTurnIndex: number;
  currentResponse: string;
  isLoadingTurn: boolean;
  isSubmitting: boolean;
  canSubmit: boolean;
  aiWorkOpen: boolean;
  aiWork: NegotiationAiWork;
  rightTab: number;
  discoverySummary: Partial<DiscoverySummaryForm> | null;
  presentationSummary: Partial<PresentationForm> | null;
  objectionSummary: Partial<ObjectionSummaryForm> | null;
  onOpenHandoff: () => void;
  onScenarioChange: (scenario: NegotiationScenario) => void;
  onResponseChange: (value: string) => void;
  onSendTurn: () => void;
  onContinueToScenarioB: () => void;
  onToggleAiWork: () => void;
  onAiWorkChange: (field: "prompts" | "corrections", value: string) => void;
  onRightTabChange: (tab: number) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  /**
   * Server page boolean — short-circuits word-min Send gate, and adds top offset
   * so Exit Simulation clears the TEST MODE banner (matches Prospecting).
   */
  testBypass?: boolean;
};

function TurnExchange({
  turn,
  turnNumber,
}: {
  turn: NegotiationTurn;
  turnNumber: number;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex justify-start">
        <div className="max-w-[85%] p-5 bg-surface-container-low border border-outline-variant rounded-2xl rounded-tl-none">
          <p className="text-mono-label text-on-surface-variant mb-2">
            Dr. Kim · Turn {turnNumber}
          </p>
          <p className="text-body-md text-on-surface leading-relaxed">{turn.kimMessage}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[85%] p-5 bg-white border border-outline-variant rounded-2xl rounded-tr-none shadow-sm">
          <p className="text-mono-label text-primary mb-2 text-right">You · Turn {turnNumber}</p>
          <p className="text-body-md text-on-surface leading-relaxed">{turn.studentResponse}</p>
        </div>
      </div>
    </div>
  );
}

function OutcomeCard({
  scenario,
  outcome,
  onContinueToScenarioB,
}: {
  scenario: NegotiationScenario;
  outcome: NegotiationOutcome;
  onContinueToScenarioB: () => void;
}): React.ReactElement {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden mt-8">
      <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <h3 className="text-title-lg font-title-lg">Scenario {scenario} Outcome</h3>
        <span className="px-3 py-1 bg-secondary-fixed text-on-secondary-fixed rounded-full text-xs font-bold uppercase tracking-widest">
          Completed
        </span>
      </div>
      <div className="p-8">
        <div className="flex gap-6 items-start">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 ${
              outcome.status === "deal_agreed"
                ? "bg-green-100 text-green-700"
                : outcome.status === "kim_walked"
                  ? "bg-error-container text-error"
                  : "bg-tertiary-fixed text-on-tertiary-fixed"
            }`}
          >
            <MaterialIcon
              name={
                outcome.status === "deal_agreed"
                  ? "verified"
                  : outcome.status === "kim_walked"
                    ? "cancel"
                    : "handshake"
              }
              className="text-4xl"
            />
          </div>
          <div className="flex-1 space-y-4">
            <h4
              className={`text-headline-md font-headline-md ${
                outcome.status === "deal_agreed"
                  ? "text-green-700"
                  : outcome.status === "kim_walked"
                    ? "text-error"
                    : "text-tertiary"
              }`}
            >
              {outcome.status === "deal_agreed"
                ? "Deal closed successfully"
                : outcome.status === "kim_walked"
                  ? "Kim walked away"
                  : "Partial agreement reached"}
            </h4>
            <p className="text-body-lg text-on-surface-variant leading-relaxed">{outcome.message}</p>
            {scenario === "A" && (
              <button
                type="button"
                onClick={onContinueToScenarioB}
                className="mt-4 px-6 py-3 bg-tertiary-fixed text-on-tertiary-fixed font-bold rounded-lg hover:brightness-95 active:scale-95 transition-all flex items-center gap-2"
              >
                Continue to Scenario B →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the full Negotiation stage grid and footer.
 */
export function NegotiationStageLayout({
  activeScenario,
  scenarioAState,
  scenarioBState,
  scenarioAData,
  scenarioBData,
  currentTurnIndex,
  currentResponse,
  isLoadingTurn,
  isSubmitting,
  canSubmit,
  aiWorkOpen,
  aiWork,
  rightTab,
  discoverySummary,
  presentationSummary,
  objectionSummary,
  onOpenHandoff,
  onScenarioChange,
  onResponseChange,
  onSendTurn,
  onContinueToScenarioB,
  onToggleAiWork,
  onAiWorkChange,
  onRightTabChange,
  onSaveDraft,
  onSubmit,
  testBypass = false,
}: NegotiationStageLayoutProps): React.ReactElement {
  const activeData = activeScenario === "A" ? scenarioAData : scenarioBData;
  const activeComplete = activeScenario === "A" ? scenarioAState === "complete" : scenarioBState === "complete";
  const responseWords = wordCount(currentResponse);
  const canSendTurn = testBypass || responseWords >= NEGOTIATION_MIN_WORDS;
  const showFloatingStatus =
    !activeComplete && currentTurnIndex >= 0 && (activeScenario === "A" ? scenarioAState === "active" : scenarioBState === "active");
  const priorContextSections = buildNegotiationPriorContext(
    discoverySummary,
    presentationSummary,
    objectionSummary
  );

  const topOffsetClass = testBypass ? "pt-28" : "pt-16";
  const railTopClass = testBypass ? "top-28" : "top-16";
  const railHeightClass = testBypass ? "h-[calc(100vh-7rem)]" : "h-[calc(100vh-64px)]";

  return (
    <div
      className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${topOffsetClass}`}
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel (matches Stages 2–4 mission briefing) ─── */}
        <aside
          className={`fixed left-0 ${railTopClass} w-[280px] ${railHeightClass} bg-primary-container text-on-primary p-6 flex flex-col gap-6 border-r border-white/5 z-40 overflow-y-auto`}
        >
          <TempoExitSimulation />
          <section>
            <h2 className="font-label-sm text-label-sm uppercase tracking-widest text-on-primary-container mb-4">
              Mission Briefing
            </h2>
            <h1 className="font-headline-md text-headline-md mb-2">Close the deal with Dr. Kim.</h1>
            <p className="text-on-primary/70 font-body-md">
              Phase 5: Negotiation — defend value in Scenario A, then trade levers to reach final
              terms in Scenario B.
            </p>
          </section>

          <section className="space-y-2">
            <div
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${
                scenarioAState === "complete"
                  ? "bg-tertiary-fixed/20 border border-tertiary-fixed/40"
                  : scenarioAState === "active"
                    ? "bg-white/15 border border-white/30 font-bold shadow-sm"
                    : "bg-white/5 border border-white/10"
              }`}
            >
              <div className="flex items-center gap-3">
                <MaterialIcon
                  name={scenarioAState === "complete" ? "check_circle" : "radio_button_checked"}
                  className={scenarioAState === "complete" ? "text-tertiary-fixed" : "text-on-primary-container"}
                  filled={scenarioAState === "complete"}
                />
                <span className="text-body-md font-medium">Scenario A</span>
              </div>
              {scenarioAState === "complete" && (
                <span className="text-[10px] bg-tertiary-fixed/30 text-on-tertiary-fixed px-1.5 py-0.5 rounded font-bold uppercase">
                  Done
                </span>
              )}
            </div>

            <div
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${
                scenarioBState === "locked"
                  ? "opacity-50 cursor-not-allowed bg-white/5 border border-white/10"
                  : scenarioBState === "complete"
                    ? "bg-tertiary-fixed/20 border border-tertiary-fixed/40"
                    : "bg-white/15 border border-white/30 font-bold shadow-sm"
              }`}
            >
              <div className="flex items-center gap-3">
                <MaterialIcon
                  name={
                    scenarioBState === "locked"
                      ? "lock"
                      : scenarioBState === "complete"
                        ? "check_circle"
                        : "radio_button_checked"
                  }
                  className={scenarioBState === "complete" ? "text-tertiary-fixed" : "text-on-primary-container"}
                  filled={scenarioBState === "complete"}
                />
                <span className="text-body-md font-medium">Scenario B</span>
              </div>
              {scenarioBState === "complete" && (
                <span className="text-[10px] bg-tertiary-fixed/30 text-on-tertiary-fixed px-1.5 py-0.5 rounded font-bold uppercase">
                  Done
                </span>
              )}
            </div>

            {showFloatingStatus && (
              <div className="inline-flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/20 w-fit mt-2">
                <span className="w-2 h-2 rounded-full bg-tertiary-fixed animate-pulse shrink-0" />
                <span className="font-mono-label text-on-primary-container text-[11px] uppercase tracking-wide">
                  Scenario {activeScenario} · Turn {currentTurnIndex + 1}
                </span>
              </div>
            )}
          </section>

          <section className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center font-bold text-on-secondary-container">
                SK
              </div>
              <div>
                <div className="font-label-md text-label-md">Dr. Saul Kim</div>
                <div className="text-xs text-on-primary/50">Founder & Owner, Summit Dental</div>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <span className="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed text-[10px] rounded uppercase font-bold">
                Analytical
              </span>
              <span className="px-2 py-1 bg-secondary-fixed text-on-secondary-fixed text-[10px] rounded uppercase font-bold">
                Careful
              </span>
            </div>
          </section>

          <section>
            <h3 className="font-label-md text-label-md mb-3 flex items-center gap-2">
              <MaterialIcon name="lightbulb" className="text-tertiary-fixed" />
              Strategy Tips
            </h3>
            <ul className="space-y-2">
              {NEGOTIATION_STRATEGY_TIPS.map((tip) => (
                <li key={tip} className="flex gap-2 text-sm text-on-primary/80">
                  <span className="text-tertiary-fixed mt-0.5 shrink-0">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-auto pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onOpenHandoff}
              className="w-full py-3 bg-white/10 hover:bg-white/20 text-on-primary rounded-lg font-medium transition-colors"
            >
              View Briefing
            </button>
          </div>
        </aside>

        {/* ── Center panel ─── */}
        <section className="ml-[280px] mr-[320px] flex-1 overflow-y-auto bg-background px-10 py-8 pb-32">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-1 border-b border-outline-variant mb-8">
              <button
                type="button"
                onClick={() => onScenarioChange("A")}
                className={`px-6 py-3 text-body-md flex items-center gap-2 ${
                  activeScenario === "A"
                    ? "text-primary font-bold border-b-2 border-primary bg-surface-container-low"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                Scenario A: Value Defense
                {scenarioAState === "complete" && (
                  <MaterialIcon name="check_circle" className="text-tertiary text-sm" filled />
                )}
              </button>
              <button
                type="button"
                onClick={() => scenarioBState !== "locked" && onScenarioChange("B")}
                disabled={scenarioBState === "locked"}
                className={`px-6 py-3 text-body-md flex items-center gap-2 ${
                  scenarioBState === "locked"
                    ? "text-on-surface-variant/50 cursor-not-allowed"
                    : activeScenario === "B"
                      ? "text-primary font-bold border-b-2 border-primary bg-surface-container-low"
                      : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {scenarioBState === "locked" && (
                  <MaterialIcon name="lock" className="text-[18px]" />
                )}
                Scenario B: Concession Management
                {scenarioBState === "complete" && (
                  <MaterialIcon name="check_circle" className="text-tertiary text-sm" filled />
                )}
              </button>
            </div>

            {activeScenario === "A" && (
              <div className="bg-[#fffbeb] border border-tertiary-container/30 rounded-xl p-6 mb-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <MaterialIcon name="gavel" className="text-[64px]" />
                </div>
                <div className="flex items-center gap-2 text-tertiary font-bold mb-4">
                  <MaterialIcon name="info" className="text-[20px]" />
                  <span className="text-title-lg font-title-lg">Scenario A: Value Defense</span>
                </div>
                <p className="text-on-surface-variant text-body-md mb-6 leading-relaxed max-w-2xl">
                  Dr. Kim has reviewed the proposal but is pushing hard for a discount. Your goal is
                  to hold price and re-anchor on value without unnecessary concessions.
                </p>
                <div className="bg-white/80 border-l-4 border-tertiary rounded-r-lg p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-2 text-tertiary font-bold">
                    <MaterialIcon name="chat_bubble" className="text-[18px]" />
                    <span className="text-mono-label font-mono-label">DR. KIM&apos;S OPENING POSITION</span>
                  </div>
                  <blockquote className="text-on-surface italic font-medium leading-relaxed">
                    &ldquo;Your software fits our needs, but $1,432 a month across eight locations
                    — that&apos;s over $17,000 a year. I can get SlotEasy for half that. Take 25% off
                    right now or I don&apos;t think we can move forward.&rdquo;
                  </blockquote>
                </div>
              </div>
            )}

            {activeScenario === "B" && (
              <>
                {scenarioAState === "complete" && (
                  <div className="mb-8 p-4 bg-green-50 border border-green-100 rounded-xl flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <MaterialIcon name="verified" className="text-green-700" />
                    </div>
                    <div>
                      <p className="text-mono-label text-green-800">Scenario A Outcome</p>
                      <p className="text-body-md font-bold text-green-900">
                        {getOutcomeStatusLabel(scenarioAData.outcome)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="p-6 bg-[#eff6ff] border border-blue-100 rounded-xl shadow-sm mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center">
                      <span className="text-blue-900 font-bold text-sm">SK</span>
                    </div>
                    <div>
                      <h3 className="text-body-md font-bold text-blue-900">Dr. Saul Kim</h3>
                      <p className="text-[12px] text-blue-700 font-mono-label">Opening Position</p>
                    </div>
                  </div>
                  <p className="text-body-md text-blue-900 italic leading-relaxed mb-4">
                    &ldquo;Okay, I&apos;m willing to move forward — but I want better terms. Monthly
                    billing, no annual lock-in. And I want you to throw in the onboarding for free.
                    Dana also wants to add the ninth location we&apos;re planning. What can you
                    do?&rdquo;
                  </p>
                  <div className="bg-white/60 rounded-lg p-3 border border-blue-100">
                    <p className="text-mono-label text-[11px] text-blue-700 mb-2 uppercase">
                      Available levers
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-xs text-blue-800">
                      <span>Annual commitment ↔ 15% off</span>
                      <span>Onboarding fee ↔ $500/location</span>
                      <span>9th location ↔ Higher ACV</span>
                      <span>Monthly billing ↔ Higher rate</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-8">
              {activeData.turns.map((turn, index) => {
                const turnNumber = index + 1;
                if (turn.state === "submitted") {
                  return <TurnExchange key={turnNumber} turn={turn} turnNumber={turnNumber} />;
                }
                if (turn.state === "active" && !activeComplete) {
                  return (
                    <div key={turnNumber} className="pt-4 border-t border-outline-variant">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        <h3 className="text-body-md font-bold">Turn {turnNumber}: Your Response</h3>
                        <span className="text-mono-label text-on-surface-variant/60 ml-auto">
                          {responseWords} / {NEGOTIATION_MIN_WORDS} words minimum
                        </span>
                      </div>
                      {turn.kimMessage && turnNumber > 1 && (
                        <div className="flex justify-start mb-4">
                          <div className="max-w-[85%] p-5 bg-surface-container-low border border-outline-variant rounded-2xl rounded-tl-none">
                            <p className="text-mono-label text-on-surface-variant mb-2">
                              Dr. Kim · Turn {turnNumber}
                            </p>
                            <p className="text-body-md text-on-surface leading-relaxed">
                              {turn.kimMessage}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-1 focus-within:border-secondary transition-all shadow-sm">
                        <textarea
                          className="w-full h-40 p-4 bg-transparent border-none focus:ring-0 text-body-md resize-none placeholder:text-on-surface-variant/50 outline-none"
                          placeholder="Draft your formal response here. Reference the levers in your sidebar..."
                          value={currentResponse}
                          onChange={(e) => onResponseChange(e.target.value)}
                        />
                        <div className="flex justify-between items-center p-3 border-t border-outline-variant bg-surface-container-low rounded-b-xl">
                          <span className="text-xs text-on-surface-variant/40 italic">
                            Formal written response
                          </span>
                          <button
                            type="button"
                            disabled={!canSendTurn || isLoadingTurn}
                            onClick={onSendTurn}
                            className={`px-6 py-2 font-bold rounded-lg text-body-md shadow-md transition-all ${
                              canSendTurn && !isLoadingTurn
                                ? "bg-primary text-on-primary hover:-translate-y-[1px] active:translate-y-0"
                                : "bg-surface-variant text-on-surface-variant/40 cursor-not-allowed opacity-50"
                            }`}
                          >
                            {isLoadingTurn ? (
                              <span className="flex items-center gap-2">
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Dr. Kim is responding...
                              </span>
                            ) : (
                              "Send Response"
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={turnNumber} className="pt-4 border-t border-outline-variant opacity-50">
                    <div className="flex items-center gap-2 mb-4">
                      <MaterialIcon name="lock" className="text-on-surface-variant text-[18px]" />
                      <h3 className="text-body-md text-on-surface-variant">
                        Turn {turnNumber}: Complete Turn {turnNumber - 1} first
                      </h3>
                    </div>
                    <div className="h-24 bg-surface-container border-2 border-dashed border-outline-variant rounded-xl" />
                  </div>
                );
              })}
            </div>

            {activeComplete && activeData.outcome && (
              <OutcomeCard
                scenario={activeScenario}
                outcome={activeData.outcome}
                onContinueToScenarioB={onContinueToScenarioB}
              />
            )}

            {(scenarioAState === "complete" || scenarioBState === "complete") && (
              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl mt-8">
                <button
                  type="button"
                  onClick={onToggleAiWork}
                  className="w-full p-6 border-b border-outline-variant flex justify-between items-center cursor-pointer hover:bg-surface-container-low transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <MaterialIcon name="psychology" className="text-primary" />
                    <h3 className="text-title-lg font-title-lg">Show Your AI Work</h3>
                    <span className="text-mono-label text-on-surface-variant text-xs ml-2">
                      REQUIRED
                    </span>
                  </div>
                  <MaterialIcon name={aiWorkOpen ? "expand_less" : "expand_more"} />
                </button>

                {aiWorkOpen && (
                  <div className="p-6 space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <label className="text-body-md font-bold text-on-surface-variant">
                          What prompts did you use to prepare your negotiation strategy?
                        </label>
                        <textarea
                          className="w-full p-4 bg-surface-container rounded-lg border border-outline-variant font-mono-code text-body-md h-40 resize-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary outline-none transition-all"
                          placeholder="Paste the exact prompts you used..."
                          value={aiWork.prompts}
                          onChange={(e) => onAiWorkChange("prompts", e.target.value)}
                        />
                      </div>
                      <div className="space-y-4">
                        <label className="text-body-md font-bold text-on-surface-variant">
                          How did you edit or improve the AI suggestions?
                        </label>
                        <textarea
                          className="w-full p-4 bg-surface-container rounded-lg border border-outline-variant text-body-md h-40 resize-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary outline-none transition-all"
                          placeholder="What did the AI get wrong? What did you change and why?"
                          value={aiWork.corrections}
                          onChange={(e) => onAiWorkChange("corrections", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="pt-6 border-t border-outline-variant">
                      <h4 className="text-mono-label font-mono-label opacity-60 mb-4">
                        EARNABLE BADGES
                      </h4>
                      <div className="flex gap-4 flex-wrap">
                        {[
                          {
                            icon: "shield",
                            label: "Defended Value Before Price",
                            color: "bg-primary-container text-on-primary-container",
                            earned: scenarioAState === "complete",
                          },
                          {
                            icon: "currency_exchange",
                            label: "Traded, Didn't Concede",
                            color: "bg-secondary-container text-on-secondary-container",
                            earned: scenarioBState === "complete",
                          },
                        ].map((badge) => (
                          <div
                            key={badge.label}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-sm transition-opacity ${
                              badge.earned
                                ? `${badge.color} border-transparent`
                                : "bg-surface-container border-outline-variant opacity-50"
                            }`}
                          >
                            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                              <MaterialIcon name={badge.icon} filled />
                            </div>
                            <div>
                              <p className="font-bold text-sm">{badge.label}</p>
                              <p className="text-xs opacity-80">
                                {badge.earned ? "Earned" : "Complete scenario to unlock"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Right panel ─── */}
        <aside
          className={`fixed right-0 ${railTopClass} ${railHeightClass} w-[320px] bg-surface-container border-l border-outline-variant flex flex-col z-30`}
        >
          <div className="p-6 border-b border-outline-variant bg-surface shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center">
                <MaterialIcon name="description" className="text-secondary text-lg" />
              </div>
              <h2 className="text-title-lg font-title-lg">Reference Library</h2>
            </div>
            <div className="flex gap-1">
              {["Levers", "Prior Context"].map((tab, i) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onRightTabChange(i)}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-tighter ${
                    rightTab === i
                      ? "border-b-4 border-primary text-primary"
                      : "text-on-surface-variant opacity-60"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 pb-8 space-y-8">
            {rightTab === 0 && (
              <>
                <section className="space-y-4">
                  <h4 className="text-mono-label font-mono-label uppercase tracking-widest text-on-surface-variant/70 flex items-center gap-2">
                    <MaterialIcon name="swap_horiz" className="text-sm" />
                    Tradeable Levers
                  </h4>
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

                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                    <h4 className="text-mono-label font-mono-label uppercase tracking-widest text-on-surface-variant/70 flex items-center gap-2 mb-3">
                      <MaterialIcon name="person" className="text-sm" />
                      Persona
                    </h4>
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
              </>
            )}

            {rightTab === 1 && (
              <section className="space-y-6">
                <div>
                  <h4 className="text-mono-label font-mono-label uppercase tracking-widest text-on-surface-variant/70 mb-1">
                    Prior Context
                  </h4>
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
            )}
          </div>
        </aside>
      </div>

      <footer className="fixed bottom-0 left-[280px] right-[320px] h-24 bg-surface border-t border-outline-variant px-8 flex items-center justify-between z-40">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              canSubmit
                ? "bg-tertiary-fixed text-on-tertiary-fixed"
                : "bg-surface-container text-on-surface-variant"
            }`}
          >
            <MaterialIcon name={canSubmit ? "task_alt" : "pending"} filled={canSubmit} />
          </div>
          <div>
            <p className="text-title-lg font-bold">
              {canSubmit
                ? "Both scenarios complete + AI work done"
                : scenarioAState === "complete"
                  ? "Scenario A complete — complete Scenario B to continue"
                  : "Complete Scenario A to unlock Scenario B"}
            </p>
            <p className="text-body-md text-on-surface-variant">
              {canSubmit
                ? "All requirements met for Stage 5 submission."
                : "Complete all requirements before submitting."}
            </p>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={onSaveDraft}
            className="px-6 py-3 border border-outline-variant text-on-surface-variant font-bold rounded-lg hover:bg-surface-container-low transition-colors"
          >
            Save Draft
          </button>
          <button
            type="button"
            disabled={!canSubmit || isSubmitting}
            onClick={onSubmit}
            className={`px-8 py-3 font-bold rounded-lg shadow-lg transition-all flex items-center gap-2 ${
              canSubmit && !isSubmitting
                ? "bg-tertiary text-on-tertiary hover:brightness-110 active:scale-95"
                : "bg-outline-variant text-white opacity-50 cursor-not-allowed"
            }`}
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                Submit Negotiation
                <MaterialIcon name="send" />
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
