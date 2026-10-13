/**
 * ObjectionHandlingStageLayout.tsx
 * Presentational shell for Tempo Stage 4 Objection Handling.
 * Lobby, active video call, and post-call submit share the left briefing rail.
 * After the call, the Next bar sits inside the middle column (matches Discovery).
 * Transcript docks beside the call; playbook content lives in the Reference Library.
 * Objection tracker stays visible as live in-call feedback (not a post-call form).
 */

import { CallTranscriptPanel } from "@/components/tempo/CallTranscriptPanel";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { PostCallCompletePanel } from "@/components/tempo/PostCallCompletePanel";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import {
  OBJECTION_TIPS,
  formatObjectionTime,
  type ObjectionHandlingPhase,
  type ObjectionTracker,
  type ObjectionTranscriptEntry,
} from "@/lib/tempo-objections";

type ObjectionHandlingStageLayoutProps = {
  phase: ObjectionHandlingPhase;
  callSeconds: number;
  transcript: ObjectionTranscriptEntry[];
  objectionTracker: ObjectionTracker;
  lobbySlot: React.ReactNode;
  callSlot: React.ReactNode;
  isSubmitting: boolean;
  nextStageName: string;
  onContinueAfterCall: () => void;
  /** Extra top padding when TEST MODE banner is visible (matches Prospecting). */
  testBypass?: boolean;
};

/**
 * Maps Objection transcript roles to the shared panel entry shape.
 */
function mapObjectionTranscript(
  transcript: ObjectionTranscriptEntry[]
): { speaker: "persona" | "student"; name: string; timestamp: string; content: string }[] {
  return transcript.map((msg) => ({
    speaker: msg.role === "student" ? "student" : "persona",
    name: msg.role === "student" ? "You" : "Dr. Saul Kim",
    timestamp: msg.timestamp,
    content: msg.content,
  }));
}

/**
 * Strategy hint copy — same conditionals as the former Transcript tab footer.
 */
function strategyHintText(objectionTracker: ObjectionTracker): string {
  if (objectionTracker.price && !objectionTracker.priceHandled) {
    return "Acknowledge the expansion costs, then pivot to how no-show recovery dwarfs the monthly cost.";
  }
  if (objectionTracker.adoption && !objectionTracker.adoptionHandled) {
    return "Reassure Dr. Kim on training and onboarding — most teams are live in days, not weeks.";
  }
  if (objectionTracker.statusQuo && !objectionTracker.statusQuoHandled) {
    return "Make the cost of inaction visible — no-show revenue leak and front desk turnover risk.";
  }
  return "Acknowledge the concern first — then reconnect to the business issue.";
}

/**
 * Renders the Objection Handling chrome; center panel swaps by phase.
 */
export function ObjectionHandlingStageLayout({
  phase,
  callSeconds,
  transcript,
  objectionTracker,
  lobbySlot,
  callSlot,
  isSubmitting,
  nextStageName,
  onContinueAfterCall,
  testBypass = false,
}: ObjectionHandlingStageLayoutProps): React.ReactElement {
  const isCallPhase = phase === "connecting" || phase === "active";
  const panelEntries = mapObjectionTranscript(transcript);
  const durationLabel = formatObjectionTime(callSeconds);

  const strategyFooter =
    phase === "active" ? (
      <div className="p-4 border-t border-white/10 bg-white/[0.02]">
        <p className="text-[11px] font-bold uppercase tracking-wider text-tertiary-container mb-2 flex items-center gap-1">
          <MaterialIcon name="lightbulb" className="text-[16px]" />
          Strategy Hint
        </p>
        <div className="p-3 rounded-lg bg-white/[0.06] border border-white/10 text-sm italic text-white/80">
          {strategyHintText(objectionTracker)}
        </div>
      </div>
    ) : null;

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

        {isCallPhase && (
          <div className="flex flex-1 min-w-0 min-h-0">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">{callSlot}</div>
            <CallTranscriptPanel
              entries={panelEntries}
              variant="live"
              footer={strategyFooter}
            />
          </div>
        )}

        {phase === "summary" && (
          <section className="flex-1 bg-surface-container-lowest flex flex-col min-w-0">
            <div className="h-12 bg-surface-container-low border-b border-outline-variant shrink-0 flex items-center justify-between px-4 lg:px-xl gap-4">
              <div className="flex items-center gap-sm text-on-surface-variant min-w-0">
                <span className="text-label-sm">Call complete</span>
              </div>
              <TempoStageForwardNav
                forwardLabel="Next"
                forwardDisabled={isSubmitting}
                onForward={onContinueAfterCall}
              />
            </div>
            <div className="flex flex-1 min-w-0 min-h-0">
              <PostCallCompletePanel
                callLengthLabel={durationLabel}
                nextStageName={nextStageName}
                isSubmitting={isSubmitting}
              />
              <CallTranscriptPanel
                entries={panelEntries}
                variant="ended"
                durationLabel={durationLabel}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
