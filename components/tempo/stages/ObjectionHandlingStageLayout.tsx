/**
 * ObjectionHandlingStageLayout.tsx
 * Presentational 3-column shell for Tempo Stage 4 Objection Handling.
 * Lobby, active video call, and post-call submit share the same side panels.
 * Objection tracker stays visible as live in-call feedback (not a post-call form).
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { PostCallCompletePanel } from "@/components/tempo/PostCallCompletePanel";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import type { PresentationForm } from "@/lib/tempo-presentation";
import {
  OBJECTION_TIPS,
  TEMPO_OBJECTION_FACTS,
  formatObjectionTime,
  type ObjectionHandlingPhase,
  type ObjectionTracker,
  type ObjectionTranscriptEntry,
} from "@/lib/tempo-objections";

type ObjectionHandlingStageLayoutProps = {
  phase: ObjectionHandlingPhase;
  callSeconds: number;
  activeTab: number;
  onTabChange: (index: number) => void;
  transcript: ObjectionTranscriptEntry[];
  objectionTracker: ObjectionTracker;
  presentationSummary: PresentationForm | null;
  lobbySlot: React.ReactNode;
  callSlot: React.ReactNode;
  isSubmitting: boolean;
  nextStageName: string;
  onContinueAfterCall: () => void;
  /** Extra top padding when TEST MODE banner is visible (matches Prospecting). */
  testBypass?: boolean;
};

/**
 * Renders the Objection Handling chrome; center panel swaps by phase.
 */
export function ObjectionHandlingStageLayout({
  phase,
  callSeconds,
  activeTab,
  onTabChange,
  transcript,
  objectionTracker,
  presentationSummary,
  lobbySlot,
  callSlot,
  isSubmitting,
  nextStageName,
  onContinueAfterCall,
  testBypass = false,
}: ObjectionHandlingStageLayoutProps): React.ReactElement {
  const isCallPhase = phase === "connecting" || phase === "active";

  return (
    <div
      className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
        testBypass ? "pt-28" : "pt-16"
      }`}
    >
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel (matches Stage 2 Discovery mission briefing) ─── */}
        <aside className="w-60 xl:w-72 bg-primary-container text-on-primary p-lg flex flex-col gap-lg border-r border-white/5 shrink-0 hidden lg:flex overflow-y-auto">
          <TempoExitSimulation />
          <section>
            <h2 className="font-label-sm text-label-sm uppercase tracking-widest text-on-primary-container mb-4">
              Mission Briefing
            </h2>
            <h1 className="font-headline-md text-headline-md mb-2">
              Handle Dr. Kim&apos;s objections on a follow-up video call.
            </h1>
            <p className="text-on-primary/70 font-body-md">
              Address his price, adoption, and status quo concerns before moving to final
              negotiation.
            </p>
          </section>

          <section className="bg-white/5 rounded-xl p-md border border-white/10">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center font-bold text-lg text-on-secondary-container">
                SK
              </div>
              <div>
                <div className="font-label-md text-label-md">Dr. Saul Kim</div>
                <div className="text-xs text-on-primary/50 flex items-center gap-1">
                  {phase === "summary" ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-gray-400" />
                      Call ended · {formatObjectionTime(callSeconds)}
                    </>
                  ) : phase === "active" || phase === "connecting" ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500 tempo-pulse-green" />
                      On call
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500 tempo-pulse-green" />
                      Ready · Waiting on call
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-on-primary/70">
                <MaterialIcon name="work" className="text-sm" />
                <span>Founder & Owner, Summit Dental</span>
              </div>
              <div className="flex items-center gap-2 text-on-primary/70">
                <MaterialIcon name="psychology" className="text-sm" />
                <span>Leads with objections · cost-first mindset</span>
              </div>
            </div>
          </section>

          <section className="bg-tertiary/10 border border-tertiary/20 rounded-xl p-md">
            <div className="flex items-center gap-2 mb-2 text-tertiary-fixed">
              <MaterialIcon name="warning" className="text-[18px]" />
              <span className="font-label-md text-label-md uppercase tracking-tight">
                Mission Critical
              </span>
            </div>
            <p className="text-sm text-on-primary/80 leading-relaxed">
              Dr. Kim built Summit from one chair to eight locations. He views every line item as
              an attack on his margins — he is looking for a reason to say no.
            </p>
          </section>

          <section>
            <h3 className="font-label-md text-label-md mb-3 flex items-center gap-2">
              <MaterialIcon name="lightbulb" className="text-tertiary-fixed" />
              Objection Tips
            </h3>
            <ul className="space-y-3">
              {OBJECTION_TIPS.map((tip) => (
                <li key={tip} className="flex gap-3 text-sm text-on-primary/80">
                  <MaterialIcon
                    name="check_box_outline_blank"
                    className="text-on-primary/40 shrink-0"
                  />
                  {tip}
                </li>
              ))}
            </ul>
          </section>

          <div className="inline-flex items-center gap-2 bg-tertiary-container/20 px-3 py-1.5 rounded-full border border-tertiary/30 w-fit">
            <MaterialIcon name="block" className="text-[14px] text-tertiary-fixed" />
            <span className="font-mono-label text-mono-label text-tertiary-fixed">NO AI ASSISTANCE</span>
          </div>

          {phase === "active" && (
            <section className="mt-auto">
              <h3 className="font-label-sm text-label-sm uppercase tracking-widest text-on-primary-container mb-2">
                Call Duration
              </h3>
              <span className="font-code-lg text-code-lg text-white">
                {formatObjectionTime(callSeconds)}
              </span>
              <p className="text-white/40 text-xs mt-1">Target: ~15 minutes</p>
            </section>
          )}
        </aside>

        {/* ── Center panel ─── */}
        {phase === "lobby" && lobbySlot}

        {isCallPhase && callSlot}

        {phase === "summary" && (
          <PostCallCompletePanel
            callLengthLabel={formatObjectionTime(callSeconds)}
            nextStageName={nextStageName}
            isSubmitting={isSubmitting}
            onContinue={onContinueAfterCall}
          />
        )}

        {/* ── Right panel ─── */}
        <aside className="w-[320px] bg-surface-container flex flex-col border-l border-outline-variant z-30 shrink-0 hidden lg:flex min-h-0">
          <div className="flex border-b border-outline-variant h-12 shrink-0">
            {[
              { label: "Transcript", icon: "description" },
              { label: "Playbook", icon: "menu_book" },
            ].map((tab, i) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => onTabChange(i)}
                className={`flex-1 text-body-md flex items-center justify-center gap-2 ${
                  activeTab === i
                    ? "text-primary font-bold border-b-2 border-primary"
                    : "text-on-secondary-container opacity-70 hover:bg-surface-variant/50"
                }`}
              >
                <MaterialIcon name={tab.icon} className="text-[18px]" />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 0 && (
            <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0 flex flex-col">
              {phase === "active" && (
                <div className="flex items-center gap-2 mb-4 shrink-0">
                  <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
                  <span className="text-mono-label font-mono-label text-error uppercase font-bold tracking-tighter">
                    Live Transcript
                  </span>
                </div>
              )}

              {phase === "lobby" ? (
                <div className="h-32 border-2 border-dashed border-outline-variant rounded-xl flex flex-col items-center justify-center text-center p-4">
                  <MaterialIcon name="graphic_eq" className="text-outline-variant mb-2" />
                  <p className="text-body-md text-on-surface-variant/40">
                    Transcript will appear here during the call
                  </p>
                </div>
              ) : (
                <div className="space-y-6 flex-1 min-h-0 overflow-y-auto">
                  {transcript.map((msg, i) => (
                    <div
                      key={`${msg.role}-${i}`}
                      className={`flex flex-col gap-1 ${
                        msg.role === "student" ? "items-end" : "items-start"
                      }`}
                    >
                      <span
                        className={`text-[11px] font-bold uppercase ${
                          msg.role === "student" ? "text-primary" : "text-on-surface-variant"
                        }`}
                      >
                        {msg.role === "student" ? "You" : "Dr. Saul Kim"} · {msg.timestamp}
                      </span>
                      <div
                        className={`p-3 rounded-2xl max-w-[85%] text-body-md ${
                          msg.role === "student"
                            ? "bg-primary-container text-on-primary-container rounded-tr-none"
                            : "bg-surface-container-highest border border-outline-variant/30 rounded-tl-none text-on-surface"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {phase === "active" && (
                <div className="p-4 bg-surface-container-low border-t border-outline-variant shrink-0 -mx-4 -mb-4">
                  <p className="text-mono-label font-mono-label text-primary-container font-bold mb-2 flex items-center gap-1">
                    <MaterialIcon name="lightbulb" className="text-[16px]" />
                    STRATEGY HINT
                  </p>
                  <div className="p-3 bg-white rounded-lg border border-outline-variant/30 text-body-md italic text-on-surface-variant">
                    {objectionTracker.price && !objectionTracker.priceHandled
                      ? "Acknowledge the expansion costs, then pivot to how no-show recovery dwarfs the monthly cost."
                      : objectionTracker.adoption && !objectionTracker.adoptionHandled
                        ? "Reassure Dr. Kim on training and onboarding — most teams are live in days, not weeks."
                        : objectionTracker.statusQuo && !objectionTracker.statusQuoHandled
                          ? "Make the cost of inaction visible — no-show revenue leak and front desk turnover risk."
                          : "Acknowledge the concern first — then reconnect to the business issue."}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 1 && (
            <div className="flex-1 overflow-y-auto p-6 space-y-8 min-h-0">
              <section>
                <h4 className="text-body-md font-bold text-on-surface mb-3 flex items-center gap-2">
                  <MaterialIcon name="history" className="text-[16px] text-secondary" />
                  Stage 3 Pitch Summary
                </h4>
                <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant text-body-md space-y-3 text-on-surface-variant">
                  {presentationSummary ? (
                    <>
                      <p>
                        • Business case:{" "}
                        {presentationSummary.businessCase?.slice(0, 80) || "—"}
                        {(presentationSummary.businessCase?.length ?? 0) > 80 ? "…" : ""}
                      </p>
                      <p>
                        • Proof point: {presentationSummary.proofPoint?.slice(0, 80) || "—"}
                        {(presentationSummary.proofPoint?.length ?? 0) > 80 ? "…" : ""}
                      </p>
                      <p>
                        • Next step asked: {presentationSummary.nextStep?.slice(0, 80) || "—"}
                        {(presentationSummary.nextStep?.length ?? 0) > 80 ? "…" : ""}
                      </p>
                    </>
                  ) : (
                    <p className="italic">Stage 3 pitch summary not available.</p>
                  )}
                </div>
              </section>

              <section>
                <h4 className="text-body-md font-bold text-on-surface mb-3 flex items-center gap-2">
                  <MaterialIcon name="database" className="text-[16px] text-secondary" />
                  Tempo Core Facts
                </h4>
                <div className="space-y-2">
                  {TEMPO_OBJECTION_FACTS.map((fact) => (
                    <div
                      key={fact.label}
                      className="flex justify-between p-3 bg-surface-container-lowest rounded-lg border border-outline-variant"
                    >
                      <span className="text-body-md text-on-surface-variant">{fact.label}</span>
                      <span className="text-body-md font-bold">{fact.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
