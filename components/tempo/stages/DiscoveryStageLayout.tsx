/**
 * DiscoveryStageLayout.tsx
 * Presentational 3-column shell for Tempo Stage 2 Discovery during lobby, call,
 * and post-call submit (mission briefing, center, reference + transcript).
 * The top app bar lives in DiscoveryStage; OPC prep gates before the lobby
 * (DiscoveryPreCallPrep → DiscoveryLobby). The active call center is injected
 * via callSlot so the mic session only mounts after Join Call.
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { PostCallCompletePanel } from "@/components/tempo/PostCallCompletePanel";
import { TempoExitSimulation } from "@/components/tempo/TempoExitSimulation";
import {
  DISCOVERY_TIPS,
  TEMPO_VALUE_DRIVERS,
  formatDiscoveryTime,
  type DiscoveryPhase,
  type DiscoveryTranscriptEntry,
} from "@/lib/tempo-discovery";

type DiscoveryStageLayoutProps = {
  phase: DiscoveryPhase;
  callSeconds: number;
  referenceCollapsed: boolean;
  onToggleReference: () => void;
  transcript: DiscoveryTranscriptEntry[];
  lobbySlot: React.ReactNode;
  callSlot: React.ReactNode;
  isSubmitting: boolean;
  nextStageName: string;
  onContinueAfterCall: () => void;
};

/**
 * Renders the Discovery call/submit chrome; center swaps by phase.
 */
export function DiscoveryStageLayout({
  phase,
  callSeconds,
  referenceCollapsed,
  onToggleReference,
  transcript,
  lobbySlot,
  callSlot,
  isSubmitting,
  nextStageName,
  onContinueAfterCall,
}: DiscoveryStageLayoutProps): React.ReactElement {
  const isCallPhase = phase === "connecting" || phase === "active";

  return (
    <div className="fixed inset-0 z-[45] flex flex-col pt-16 overflow-hidden bg-surface">
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel ─── */}
        <aside className="w-60 xl:w-72 bg-primary-container text-on-primary p-lg flex flex-col gap-lg border-r border-white/5 shrink-0 hidden lg:flex overflow-y-auto">
          <TempoExitSimulation />
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
        {(phase === "prep" || phase === "lobby") && lobbySlot}

        {isCallPhase && callSlot}

        {phase === "summary" && (
          <PostCallCompletePanel
            callLengthLabel={formatDiscoveryTime(callSeconds)}
            nextStageName={nextStageName}
            isSubmitting={isSubmitting}
            onContinue={onContinueAfterCall}
          />
        )}

        {/* ── Right panel ─── */}
        <aside className="w-72 xl:w-80 bg-surface-container-low flex flex-col border-l border-outline-variant shrink-0 hidden lg:flex min-h-0">
          <section
            className={`border-b border-outline-variant flex flex-col overflow-hidden ${
              referenceCollapsed ? "shrink-0" : "flex-1 min-h-0"
            }`}
          >
            <button
              type="button"
              onClick={onToggleReference}
              className="p-md border-b border-outline-variant flex items-center justify-between bg-surface-container hover:bg-surface-container-high transition-colors text-left w-full"
            >
              <h3 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Reference: Tempo Product
              </h3>
              <MaterialIcon name={referenceCollapsed ? "expand_more" : "expand_less"} />
            </button>
            {!referenceCollapsed && (
              <div className="flex-1 p-lg overflow-y-auto space-y-lg custom-scrollbar min-h-0">
                <div>
                  <h4 className="font-headline-md text-headline-md mb-1">Tempo</h4>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Scheduling software for appointment-based businesses. Core value: keep
                    calendars full, stop losing money to no-shows.
                  </p>
                </div>
                <div className="space-y-2">
                  <h5 className="text-xs font-bold uppercase text-on-surface-variant opacity-60">
                    Value Drivers
                  </h5>
                  <div className="grid grid-cols-1 gap-2">
                    {TEMPO_VALUE_DRIVERS.map((value) => (
                      <div
                        key={value}
                        className="p-2 bg-surface-container rounded border border-outline-variant/30 text-xs"
                      >
                        {value}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="flex-1 flex flex-col min-h-0 bg-surface-container-high/50">
            <div className="p-md border-b border-outline-variant flex items-center gap-2 bg-surface-container shrink-0">
              <MaterialIcon name="subtitles" className="text-sm" />
              <h3 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Live Transcript
              </h3>
              {phase === "active" && (
                <div className="ml-auto flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
                  <span className="text-[10px] font-bold text-error uppercase">LIVE</span>
                </div>
              )}
              {phase === "summary" && (
                <span className="ml-auto text-[10px] text-on-surface-variant">
                  Call ended · {formatDiscoveryTime(callSeconds)}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-lg space-y-lg custom-scrollbar min-h-0">
              {transcript.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-lg">
                  <MaterialIcon name="waves" className="text-4xl text-on-surface-variant/20 mb-2" />
                  <p className="text-sm text-on-surface-variant/50 italic">
                    Transcript will appear here during the call.
                  </p>
                </div>
              ) : (
                transcript.map((msg, i) => (
                  <div key={`${msg.role}-${i}`} className="space-y-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-label-sm text-label-sm font-bold ${
                          msg.role === "dana" ? "text-on-surface" : "text-secondary"
                        }`}
                      >
                        {msg.role === "dana" ? "Dana Reyes" : "You"}
                      </span>
                      <span className="text-[10px] text-outline font-code-md">{msg.timestamp}</span>
                    </div>
                    <p
                      className={`text-on-surface-variant leading-relaxed ${
                        msg.role === "student" ? "italic" : ""
                      }`}
                    >
                      {msg.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
