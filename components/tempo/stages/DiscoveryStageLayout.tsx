/**
 * DiscoveryStageLayout.tsx
 * Presentational shell for Tempo Stage 2 Discovery during prep, lobby, call,
 * and post-call submit (mission briefing, center, docked transcript).
 * The top app bar lives in DiscoveryStage; OPC prep gates before the lobby
 * (DiscoveryPreCallPrep → DiscoveryLobby) via a Next bar inside the middle
 * column that matches ProspectingWizard's. The active call center is injected
 * via callSlot so the mic session only mounts after Join Call.
 */

import { CallTranscriptPanel } from "@/components/tempo/CallTranscriptPanel";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { PostCallCompletePanel } from "@/components/tempo/PostCallCompletePanel";
import { TempoStageForwardNav } from "@/components/tempo/TempoStageForwardNav";
import {
  DISCOVERY_TIPS,
  formatDiscoveryTime,
  type DiscoveryPhase,
  type DiscoveryTranscriptEntry,
} from "@/lib/tempo-discovery";

type DiscoveryStageLayoutProps = {
  phase: DiscoveryPhase;
  callSeconds: number;
  transcript: DiscoveryTranscriptEntry[];
  lobbySlot: React.ReactNode;
  callSlot: React.ReactNode;
  /** Prep Next gate, computed in DiscoveryStage with canBeginDiscoveryCall. */
  isPrepNextEnabled: boolean;
  /** Prep Next click: autofill (test bypass), save, then move to the lobby. */
  onPrepNext: () => void;
  isSubmitting: boolean;
  nextStageName: string;
  onContinueAfterCall: () => void;
  /** Extra top padding when TEST MODE banner is visible (matches Prospecting). */
  testBypass?: boolean;
};

/**
 * Maps Discovery transcript roles to the shared panel entry shape.
 */
function mapDiscoveryTranscript(
  transcript: DiscoveryTranscriptEntry[]
): { speaker: "persona" | "student"; name: string; timestamp: string; content: string }[] {
  return transcript.map((msg) => ({
    speaker: msg.role === "dana" ? "persona" : "student",
    name: msg.role === "dana" ? "Dana Reyes" : "You",
    timestamp: msg.timestamp,
    content: msg.content,
  }));
}

/**
 * Forward bar at the top of the middle column. Same height, colors, padding,
 * and border as ProspectingWizard's bar; the left text may wrap to two lines.
 */
function DiscoveryForwardBar({
  statusText,
  children,
}: {
  statusText: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="h-12 bg-surface-container-low border-b border-outline-variant shrink-0 flex items-center justify-between px-4 lg:px-xl gap-4">
      <div className="flex items-center gap-sm text-on-surface-variant min-w-0">
        <span className="text-label-sm">{statusText}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Renders the Discovery call/submit chrome; center swaps by phase.
 */
export function DiscoveryStageLayout({
  phase,
  callSeconds,
  transcript,
  lobbySlot,
  callSlot,
  isPrepNextEnabled,
  onPrepNext,
  isSubmitting,
  nextStageName,
  onContinueAfterCall,
  testBypass = false,
}: DiscoveryStageLayoutProps): React.ReactElement {
  const isCallPhase = phase === "connecting" || phase === "active";
  const panelEntries = mapDiscoveryTranscript(transcript);
  const durationLabel = formatDiscoveryTime(callSeconds);

  return (
    <div
      className={`fixed inset-0 z-[45] flex flex-col overflow-hidden bg-surface ${
        testBypass ? "pt-28" : "pt-16"
      }`}
    >
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel ─── */}
        <aside className="w-60 xl:w-72 bg-primary-container text-on-primary p-lg flex flex-col gap-lg border-r border-white/5 shrink-0 hidden lg:flex overflow-y-auto">
          <section>
            <h2 className="font-label-sm text-label-sm uppercase tracking-widest text-on-primary-container mb-4">
              Mission Briefing
            </h2>
            <h1 className="font-headline-md text-headline-md mb-2">
              Run a 15-minute discovery call with Dana Reyes.
            </h1>
            <p className="text-on-primary/70 font-body-md">
              Your goal is to uncover their business issues around scheduling before moving to the
              proposal stage.
            </p>
          </section>

          <section className="bg-white/5 rounded-xl p-md border border-white/10">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center font-bold text-lg text-on-secondary-container">
                DR
              </div>
              <div>
                <div className="font-label-md text-label-md">Dana Reyes</div>
                <div className="text-xs text-on-primary/50 flex items-center gap-1">
                  {phase !== "summary" ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500 tempo-pulse-green" />
                      Available
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-gray-400" />
                      Call ended
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-on-primary/70">
                <MaterialIcon name="work" className="text-sm" />
                <span>Director of Operations, Summit Dental</span>
              </div>
              <div className="flex items-center gap-2 text-on-primary/70">
                <MaterialIcon name="business" className="text-sm" />
                <span>8 dental practices, Colorado</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="font-label-md text-label-md mb-3 flex items-center gap-2">
              <MaterialIcon name="lightbulb" className="text-tertiary-fixed" />
              Discovery Tips
            </h3>
            <ul className="space-y-3">
              {DISCOVERY_TIPS.map((tip) => (
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

          {phase === "active" && (
            <section className="mt-auto">
              <h3 className="font-label-sm text-label-sm uppercase tracking-widest text-on-primary-container mb-2">
                Call Duration
              </h3>
              <span className="font-code-lg text-code-lg text-white">
                {formatDiscoveryTime(callSeconds)}
              </span>
              <p className="text-white/40 text-xs mt-1">Target: 15 minutes</p>
            </section>
          )}
        </aside>

        {/* ── Center panel ─── */}
        {phase === "prep" && (
          <section className="flex-1 bg-surface-container-lowest flex flex-col min-w-0">
            <DiscoveryForwardBar statusText="This plan is required before you can continue. Treat it as a starting point, not a script.">
              <TempoStageForwardNav
                forwardLabel="Next"
                forwardDisabled={!isPrepNextEnabled}
                onForward={onPrepNext}
                forwardHint={isPrepNextEnabled ? null : "Fill in your call plan to continue"}
              />
            </DiscoveryForwardBar>
            <div className="flex flex-1 min-h-0">{lobbySlot}</div>
          </section>
        )}

        {phase === "lobby" && lobbySlot}

        {isCallPhase && (
          <div className="flex flex-1 min-w-0 min-h-0">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">{callSlot}</div>
            <CallTranscriptPanel entries={panelEntries} variant="live" />
          </div>
        )}

        {phase === "summary" && (
          <section className="flex-1 bg-surface-container-lowest flex flex-col min-w-0">
            <DiscoveryForwardBar statusText="Call complete">
              <TempoStageForwardNav
                forwardLabel="Submit"
                isForwardLoading={isSubmitting}
                onForward={onContinueAfterCall}
              />
            </DiscoveryForwardBar>
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
