/**
 * TempoCallLobby.tsx
 * Shared pre-call waiting room for Tempo's live-call stages (Stage 2 Discovery and
 * Stage 4 Objection Handling), rendered as the center column of each stage's
 * 3-column layout. Left: the stage's manager note (text from its config in
 * lib/tempo-discovery.ts or lib/tempo-objections.ts). Right: camera preview,
 * mic/camera toggles, status, Join Call and Skip Call (test). The microphone and
 * camera are acquired ONLY when the student clicks their buttons (so the macOS
 * hardware indicators never light up on load); on Join Call the streams are handed
 * to the call session, and tracks that were not handed off stop on unmount.
 * Used by DiscoveryLobby and ObjectionHandlingLobby.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type TempoJoinStreams = {
  audioStream: MediaStream;
  videoStream: MediaStream | null;
};

type TempoCallLobbyProps = {
  /** The stage's manager note, one paragraph per entry (from its stage config). */
  managerNote: readonly string[];
  /** Shown when camera access is blocked (each stage keeps its own wording). */
  cameraBlockedMessage: string;
  connectError: string;
  onJoin: (streams: TempoJoinStreams) => void;
  /** Server page boolean — shows Skip Call (test) without touching Anam. */
  testBypass?: boolean;
  onSkipCall?: () => void;
};

const MIC_BLOCKED_MESSAGE = "Microphone access was blocked. Allow it in your browser settings to join.";

/** Both live-call stages show the full transcript on the post-call screen. */
const TRANSCRIPT_NOTE = "Take notes as you go. You'll get the full call transcript when the call ends.";

// ── Manager note ───

/** The yellow manager note card; fills the row's height with its footer at the bottom. */
function ManagerNoteCard({ paragraphs }: { paragraphs: readonly string[] }): React.ReactElement {
  return (
    <div className="h-full flex flex-col rounded-xl p-6 shadow-sm bg-[#FFF4CC] border border-[rgba(180,130,0,0.3)] text-[#584400]">
      <div className="flex items-center gap-2 mb-4">
        <MaterialIcon name="campaign" className="text-[20px]" />
        <h3 className="font-bold text-[16px]">Manager note</h3>
      </div>
      <div className="flex-1 space-y-3 text-[15px] leading-[1.65]">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-6 pt-4 border-t border-[rgba(88,68,0,0.15)] flex items-start gap-2.5">
        <MaterialIcon name="edit_note" className="text-[20px] shrink-0 mt-0.5" />
        <span className="text-[14px] font-semibold leading-snug">{TRANSCRIPT_NOTE}</span>
      </div>
    </div>
  );
}

// ── Lobby ───

/**
 * The pre-call lobby: "Ready to join the call?", then the manager note beside the
 * device setup and Join Call (two equal columns on desktop, stacked on mobile).
 * Join Call needs the mic; the camera is optional.
 */
export function TempoCallLobby({
  managerNote,
  cameraBlockedMessage,
  connectError,
  onJoin,
  testBypass = false,
  onSkipCall,
}: TempoCallLobbyProps): React.ReactElement {
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [deviceError, setDeviceError] = useState("");

  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const handedOffRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Stop preview tracks that were not handed off to the call session.
  useEffect(() => {
    return () => {
      if (!handedOffRef.current) {
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleMic = useCallback(async (): Promise<void> => {
    setDeviceError("");
    if (micOn) {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setMicOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicOn(true);
    } catch {
      setDeviceError(MIC_BLOCKED_MESSAGE);
    }
  }, [micOn]);

  const toggleCamera = useCallback(async (): Promise<void> => {
    setDeviceError("");
    if (cameraOn) {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
    } catch {
      setDeviceError(cameraBlockedMessage);
    }
  }, [cameraOn, cameraBlockedMessage]);

  const handleJoin = useCallback((): void => {
    const audioStream = micStreamRef.current;
    if (!audioStream) {
      return;
    }
    handedOffRef.current = true;
    onJoin({
      audioStream,
      videoStream: cameraStreamRef.current,
    });
  }, [onJoin]);

  return (
    <section className="flex-1 bg-surface p-4 lg:p-xl flex flex-col items-center justify-center relative overflow-y-auto min-w-0">
      <div className="max-w-5xl w-full flex flex-col gap-6">
        <div className="text-center">
          <h2 className="font-display text-display text-primary">Ready to join the call?</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch min-h-0">
          <ManagerNoteCard paragraphs={managerNote} />

          {/* Camera + device setup */}
          <div className="flex flex-col gap-4 min-h-0">
            <div className="relative aspect-video w-full flex-1 min-h-[200px] rounded-xl overflow-hidden bg-[#0a0a0a] border border-outline-variant shadow-inner">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover scale-x-[-1] ${cameraOn ? "" : "hidden"}`}
              />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 gap-2">
                  <MaterialIcon name="videocam_off" className="text-4xl" />
                  <span className="text-label-sm font-label-sm">Camera off</span>
                </div>
              )}
              <div className="absolute top-3 left-3">
                <div className="bg-black/40 backdrop-blur-md text-white font-label-sm text-label-sm px-3 py-1 rounded-full flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  YOU
                </div>
              </div>

              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  title="Toggle Microphone"
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                    micOn ? "bg-primary text-on-primary" : "bg-white/90 text-on-surface hover:bg-white"
                  }`}
                >
                  <MaterialIcon name={micOn ? "mic" : "mic_off"} filled={micOn} />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleCamera()}
                  title="Toggle Camera"
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                    cameraOn ? "bg-primary text-on-primary" : "bg-white/90 text-on-surface hover:bg-white"
                  }`}
                >
                  <MaterialIcon name={cameraOn ? "videocam" : "videocam_off"} filled={cameraOn} />
                </button>
              </div>
            </div>

            {(deviceError.length > 0 || connectError.length > 0) && (
              <p className="text-sm text-error text-center">{deviceError || connectError}</p>
            )}

            <div className="flex items-center justify-center gap-6">
              <div className={`flex items-center gap-2 ${micOn ? "text-primary" : "text-on-surface-variant/50"}`}>
                <MaterialIcon name={micOn ? "mic" : "mic_off"} className="text-[20px]" filled={micOn} />
                <span className="text-label-sm font-label-sm uppercase tracking-tighter">
                  {micOn ? "Mic ready" : "Mic off"}
                </span>
              </div>
              <div className={`flex items-center gap-2 ${cameraOn ? "text-primary" : "text-on-surface-variant/50"}`}>
                <MaterialIcon
                  name={cameraOn ? "videocam" : "videocam_off"}
                  className="text-[20px]"
                  filled={cameraOn}
                />
                <span className="text-label-sm font-label-sm uppercase tracking-tighter">
                  {cameraOn ? "Camera on" : "Camera off"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleJoin}
              disabled={!micOn}
              className="w-full h-14 bg-[#1a1a2e] text-white font-headline-md rounded-xl flex items-center justify-center gap-3 hover:bg-[#252545] transition-all active:scale-95 shadow-lg group disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <MaterialIcon name="video_call" filled className="group-hover:scale-105 transition-transform" />
              {micOn ? "Join Call" : "Enable mic to join"}
            </button>

            {testBypass && onSkipCall ? (
              <button
                type="button"
                onClick={onSkipCall}
                className="w-full h-11 rounded-xl border-2 border-amber-500 bg-amber-50 text-amber-950 font-label-md text-label-md hover:bg-amber-100 transition-colors"
              >
                Skip Call (test)
              </button>
            ) : null}

            <p className="text-center text-body-md text-on-surface-variant/60">Estimated duration: 15 minutes</p>
          </div>
        </div>
      </div>
    </section>
  );
}
