/**
 * TempoCallSessionShell.tsx
 * Shared in-call layout for Tempo Discovery and Objection Handling — video frame,
 * student PiP, speaking rings, and bottom control bar. Stage-specific overlays
 * (e.g. objection chips) slot in via topOverlay.
 */

"use client";

import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type TempoCallSessionShellProps = {
  /** Optional stage-specific header (e.g. objection tracker chips). */
  topOverlay?: React.ReactNode;
  connected: boolean;
  isPersonaSpeaking: boolean;
  isStudentSpeaking: boolean;
  connectingMessage: string;
  statusText: string;
  personaName: string;
  personaRole: string;
  avatar: React.ReactNode;
  studentVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  showCameraPreview: boolean;
  micMuted: boolean;
  cameraOff: boolean;
  formattedTime: string;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onEndCall: () => void;
};

/**
 * Renders the unified Tempo video-call shell used by Discovery and Objections.
 */
export function TempoCallSessionShell({
  topOverlay,
  connected,
  isPersonaSpeaking,
  isStudentSpeaking,
  connectingMessage,
  statusText,
  personaName,
  personaRole,
  avatar,
  studentVideoRef,
  showCameraPreview,
  micMuted,
  cameraOff,
  formattedTime,
  onToggleMute,
  onToggleCamera,
  onEndCall,
}: TempoCallSessionShellProps): React.ReactElement {
  return (
    <section className="flex-1 bg-[#0a0a0a] relative flex flex-col min-w-0 overflow-hidden">
      {topOverlay}

      <div className="flex-1 flex flex-col items-center justify-center px-4 pt-16 pb-4 min-h-0">
        <div
          className={`relative w-full max-w-4xl aspect-video max-h-[min(64vh,calc(100%-1rem))] rounded-3xl overflow-hidden transition-all duration-700 ${
            connected && isPersonaSpeaking ? "speaking-ring-gold" : "border border-white/10"
          }`}
        >
          <div className="absolute inset-0">{avatar}</div>

          {!connected && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70">
              <div className="w-10 h-10 border-2 border-white/20 border-t-tertiary-container rounded-full animate-spin" />
              <p className="mt-4 text-sm text-white/70">{connectingMessage}</p>
              {statusText.length > 0 && (
                <p className="mt-2 text-xs text-white/50 max-w-sm text-center px-4">{statusText}</p>
              )}
            </div>
          )}

          {/* PiP — keep <video> mounted during connect so lobby streams attach immediately */}
          <div
            className={`absolute bottom-6 right-6 w-48 aspect-video rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-neutral-800 z-10 transition-opacity duration-300 ${
              connected ? "opacity-100" : "opacity-0 pointer-events-none"
            } ${isStudentSpeaking ? "speaking-ring-blue" : ""}`}
          >
            <video
              ref={studentVideoRef as React.LegacyRef<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover scale-x-[-1] ${showCameraPreview ? "" : "hidden"}`}
            />
            {connected && !showCameraPreview && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-700">
                <MaterialIcon name="person" className="text-white/40 text-4xl" />
              </div>
            )}
            {connected && (
              <div className="absolute bottom-2 left-2 text-[10px] text-white/80 bg-black/40 px-2 py-0.5 rounded uppercase tracking-tighter">
                You (Student)
              </div>
            )}
          </div>

          {connected && (
            <div className="absolute bottom-6 left-6 glass-panel px-4 py-2 rounded-xl flex flex-col z-10">
              <span className="text-white font-bold text-title-lg">{personaName}</span>
              <span className="text-white/60 text-body-md">{personaRole}</span>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 py-5 px-4 flex items-center justify-center gap-6 border-t border-white/10 bg-black/30 backdrop-blur-md">
        {[
          { icon: "mic" as const, muted: micMuted, onClick: onToggleMute },
          { icon: "videocam" as const, muted: cameraOff, onClick: onToggleCamera },
        ].map((ctrl) => (
          <button
            key={ctrl.icon}
            type="button"
            onClick={ctrl.onClick}
            disabled={!connected}
            className={`w-14 h-14 rounded-full glass-panel flex items-center justify-center text-white hover:bg-white/20 transition-all disabled:opacity-40 ${
              ctrl.muted ? "bg-error/80" : ""
            }`}
          >
            <MaterialIcon
              name={
                ctrl.icon === "mic"
                  ? micMuted
                    ? "mic_off"
                    : "mic"
                  : cameraOff
                    ? "videocam_off"
                    : "videocam"
              }
            />
          </button>
        ))}
        <button
          type="button"
          onClick={onEndCall}
          disabled={!connected}
          className="w-20 h-14 rounded-3xl bg-error flex items-center justify-center text-white hover:opacity-90 shadow-lg shadow-error/20 transition-all disabled:opacity-40"
        >
          <MaterialIcon name="call_end" className="font-bold" />
        </button>
        {connected && (
          <div className="flex items-center gap-2 glass-panel px-4 h-14 rounded-full">
            <MaterialIcon name="timer" className="text-white/60 text-[18px]" />
            <span className="font-code-md text-white/80 tabular-nums">{formattedTime}</span>
          </div>
        )}
      </div>
    </section>
  );
}
