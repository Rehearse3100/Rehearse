/**
 * ObjectionHandlingLobby.tsx
 * Pre-call waiting room for Tempo Stage 4 — center column of the 3-column layout.
 * Mic and camera are acquired only when the student toggles them (same pattern as
 * Stage 2 Discovery). Streams are handed to the video call session on Join Call.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type ObjectionJoinStreams = {
  audioStream: MediaStream;
  videoStream: MediaStream | null;
};

type ObjectionHandlingLobbyProps = {
  connectError: string;
  onJoin: (streams: ObjectionJoinStreams) => void;
  /** Server page boolean — shows Skip Call (test) without touching Anam. */
  testBypass?: boolean;
  onSkipCall?: () => void;
};

/**
 * Center-column device setup + Dr. Kim briefing + Join Call for the lobby phase.
 */
export function ObjectionHandlingLobby({
  connectError,
  onJoin,
  testBypass = false,
  onSkipCall,
}: ObjectionHandlingLobbyProps): React.ReactElement {
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [deviceError, setDeviceError] = useState("");

  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const handedOffRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
      setDeviceError("Microphone access was blocked. Allow it in your browser settings to join.");
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
      setDeviceError("Camera access was blocked. Enable it for the video call PiP.");
    }
  }, [cameraOn]);

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
        <div className="text-center flex flex-col items-center gap-3">
          <span className="bg-surface-container-high text-primary font-label-sm text-label-sm px-3 py-1.5 rounded-lg tracking-wider font-bold">
            OBJECTION HANDLING · STAGE 4 OF 5
          </span>
          <h2 className="font-display text-display text-primary">Ready to meet Dr. Saul Kim?</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch min-h-0">
          {/* Dr. Kim preview card */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 flex flex-col items-center text-center shadow-sm h-full">
            <div className="w-16 h-16 rounded-full bg-[#1a1a2e] flex items-center justify-center text-tertiary-fixed font-headline-md font-bold mb-3 ring-4 ring-surface-container-high">
              SK
            </div>
            <p className="font-label-md text-label-md text-on-surface">Dr. Saul Kim</p>
            <p className="text-sm text-on-surface-variant mb-3">Founder & Owner · Summit Dental Group</p>
            <div className="w-full bg-surface-container-low p-4 rounded-xl border-l-4 border-primary italic text-left mb-4 flex-1">
              <p className="text-body-md leading-relaxed text-on-surface-variant">
                &ldquo;Eight locations times that price adds up fast — is it really worth it? My staff
                are already stretched thin; I&apos;m not looking to buy them more homework.&rdquo;
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 bg-tertiary-fixed text-on-tertiary-fixed px-3 py-1 rounded-full text-xs font-bold">
                <MaterialIcon name="monetization_on" className="text-[14px]" />
                Price Sensitive
              </span>
              <span className="inline-flex items-center gap-1.5 bg-tertiary-fixed text-on-tertiary-fixed px-3 py-1 rounded-full text-xs font-bold">
                <MaterialIcon name="psychology_alt" className="text-[14px]" />
                Evasion Patterns
              </span>
              <span className="inline-flex items-center gap-1.5 bg-secondary-fixed text-on-secondary-fixed px-3 py-1 rounded-full text-xs font-bold">
                <MaterialIcon name="verified" className="text-[14px]" />
                Softening Required
              </span>
            </div>
          </div>

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
