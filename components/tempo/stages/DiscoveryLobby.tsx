/**
 * DiscoveryLobby.tsx
 * Pre-call waiting room for Tempo Stage 2 Discovery — rendered as the center
 * column of the 3-column Discovery layout (same slot the call uses).
 * Only mounts after DiscoveryPreCallPrep is confirmed (gated in DiscoveryStage).
 * The microphone and camera are acquired ONLY when the student clicks their
 * respective buttons (so the macOS hardware indicators never light up on load).
 * The acquired microphone (and optional camera) streams are handed to the call session on Join Call.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type DiscoveryJoinStreams = {
  audioStream: MediaStream;
  videoStream: MediaStream | null;
};

type DiscoveryLobbyProps = {
  connectError: string;
  onJoin: (streams: DiscoveryJoinStreams) => void;
  /** Server page boolean — shows Skip Call (test) without touching Anam. */
  testBypass?: boolean;
  onSkipCall?: () => void;
};

/**
 * Center-column device setup + Join Call panel for the lobby phase.
 */
export function DiscoveryLobby({
  connectError,
  onJoin,
  testBypass = false,
  onSkipCall,
}: DiscoveryLobbyProps): React.ReactElement {
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
      setDeviceError("Camera access was blocked. You can still join with audio only.");
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
      <div className="max-w-lg w-full flex flex-col gap-6">
        <div className="text-center flex flex-col items-center gap-3">
          <h2 className="font-display text-display text-primary">Ready to meet Dana Reyes?</h2>
        </div>

        {/* Camera preview */}
        <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#0a0a0a] border border-outline-variant shadow-inner">
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
              <span className="text-label-sm font-label-sm">Camera off (optional)</span>
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
          className="w-full h-14 bg-primary-container text-on-primary font-headline-md rounded-lg flex items-center justify-center gap-3 hover:bg-black transition-all active:scale-95 shadow-lg group disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          <MaterialIcon name="call" className="group-hover:translate-x-1 transition-transform" />
          {micOn ? "Join Call" : "Enable mic to join"}
        </button>

        {testBypass && onSkipCall ? (
          <button
            type="button"
            onClick={onSkipCall}
            className="w-full h-11 mt-2 rounded-lg border-2 border-amber-500 bg-amber-50 text-amber-950 font-label-md text-label-md hover:bg-amber-100 transition-colors"
          >
            Skip Call (test)
          </button>
        ) : null}
      </div>
    </section>
  );
}
