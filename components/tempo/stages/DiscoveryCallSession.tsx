/**
 * DiscoveryCallSession.tsx
 * Anam video call for Tempo Stage 2 Discovery — shares the Objection Handling
 * in-call shell (video frame, PiP, speaking rings, control bar).
 * Receives the microphone stream the student enabled in the lobby.
 *
 * Avatar must stay mounted for the whole call (no remount on connect) — remounting
 * tears down the Anam WebRTC session and silences Dana.
 */

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { TempoCallSessionShell } from "@/components/tempo/stages/TempoCallSessionShell";
import {
  formatDiscoveryTime,
  parseDiscoveryTranscript,
  type DiscoveryTranscriptEntry,
} from "@/lib/tempo-discovery";
import { TEMPO_DISCOVERY_OPENING_GREETING } from "@/lib/constants";
import { resumePlaybackContext } from "@/lib/audio-playback";
import { useSimulationVoiceSession } from "@/hooks/useSimulationVoiceSession";
import type { AvatarRef } from "@/types";

type DiscoveryCallSessionProps = {
  attemptId: string;
  audioStream: MediaStream;
  videoStream?: MediaStream | null;
  onActive: () => void;
  onError: (message: string) => void;
  onTranscriptChange: (entries: DiscoveryTranscriptEntry[]) => void;
  onSecondsChange: (seconds: number) => void;
  onEnded: (
    transcriptText: string,
    seconds: number,
    entries: DiscoveryTranscriptEntry[]
  ) => void;
};

/**
 * Waits until Avatar imperative handle and media elements are ready.
 */
async function waitForAvatarReady(
  getRef: () => AvatarRef | null,
  maxMs = 8000
): Promise<AvatarRef | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const avatar = getRef();
    if (avatar) {
      const domReady = await avatar.waitForMediaElements(2000);
      if (domReady) {
        return avatar;
      }
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  return getRef();
}

/** Returns true when the stream has at least one live video track. */
function hasLiveVideoTrack(stream: MediaStream | null | undefined): boolean {
  return Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));
}

/**
 * Mounts the voice session on the lobby-supplied stream and renders call UI.
 */
export function DiscoveryCallSession({
  attemptId,
  audioStream,
  videoStream = null,
  onActive,
  onError,
  onTranscriptChange,
  onSecondsChange,
  onEnded,
}: DiscoveryCallSessionProps): React.ReactElement {
  const [connected, setConnected] = useState(false);
  const [isDanaSpeaking, setIsDanaSpeaking] = useState(false);
  const [isStudentSpeaking, setIsStudentSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(() => !hasLiveVideoTrack(videoStream));
  const [seconds, setSeconds] = useState(0);

  const connectStartedRef = useRef(false);
  const isMutedRef = useRef(false);
  const secondsRef = useRef(0);
  const studentVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeAudioStreamRef = useRef(audioStream);
  const activeVideoStreamRef = useRef<MediaStream | null>(videoStream);

  const voice = useSimulationVoiceSession({
    // Dana: the server builds her prompt from this key.
    persona: "tempo_discovery",
    openingGreeting: TEMPO_DISCOVERY_OPENING_GREETING,
    isMutedRef,
    attemptId,
    anamStage: "discovery",
  });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const callbacksRef = useRef({ onActive, onError });
  callbacksRef.current = { onActive, onError };

  const attachVideoPreview = useCallback((stream: MediaStream | null): void => {
    const el = studentVideoRef.current;
    if (!el) {
      return;
    }
    if (!stream || !hasLiveVideoTrack(stream)) {
      el.srcObject = null;
      return;
    }
    el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    activeVideoStreamRef.current = videoStream;
    if (videoStream && hasLiveVideoTrack(videoStream)) {
      setCameraOff(false);
    }
    attachVideoPreview(hasLiveVideoTrack(videoStream) ? videoStream : null);
  }, [videoStream, attachVideoPreview]);

  // Re-attach when call connects (safety net after connecting overlay clears).
  useLayoutEffect(() => {
    if (!connected || cameraOff) {
      return;
    }
    const stream = activeVideoStreamRef.current;
    if (stream && hasLiveVideoTrack(stream)) {
      attachVideoPreview(stream);
    }
  }, [connected, cameraOff, attachVideoPreview]);

  const stopVideoTracks = useCallback((): void => {
    activeVideoStreamRef.current?.getVideoTracks().forEach((track) => track.stop());
    activeVideoStreamRef.current = null;
    attachVideoPreview(null);
    setCameraOff(true);
  }, [attachVideoPreview]);

  // ── Connect once on mount (mic already granted in the lobby) ───
  useEffect(() => {
    if (connectStartedRef.current) {
      return;
    }
    connectStartedRef.current = true;

    const run = async (): Promise<void> => {
      await resumePlaybackContext();

      const avatar = await waitForAvatarReady(() => voiceRef.current.avatarRef.current);
      if (!avatar) {
        callbacksRef.current.onError("Could not connect to Dana Reyes. Reload and try again.");
        return;
      }

      if (audioStream.getAudioTracks().length === 0) {
        callbacksRef.current.onError("Microphone stream unavailable. Reload and try again.");
        return;
      }

      try {
        avatar.resumeAudioContext();
        await voiceRef.current.startCall(audioStream);
        await resumePlaybackContext();
        setConnected(true);
        callbacksRef.current.onActive();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Could not start voice session. Reload and try again.";
        callbacksRef.current.onError(message);
      }
    };

    void run();
  }, [audioStream]);

  // ── Call timer (local) ───
  useEffect(() => {
    if (!connected) {
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      secondsRef.current = elapsed;
      setSeconds(elapsed);
    }, 1000);
    return () => window.clearInterval(id);
  }, [connected]);

  useEffect(() => {
    onSecondsChange(seconds);
  }, [seconds, onSecondsChange]);

  // ── Bubble live transcript up to parent ───
  useEffect(() => {
    if (!connected) {
      return;
    }
    const raw = voiceRef.current.getFullTranscript();
    onTranscriptChange(parseDiscoveryTranscript(raw, secondsRef.current));
  }, [voice.userTranscripts, voice.personaTranscripts, connected, onTranscriptChange]);

  // ── Speaking indicators ───
  useEffect(() => {
    if (!voice.personaTranscripts || !connected) {
      return;
    }
    setIsDanaSpeaking(true);
    const timer = window.setTimeout(() => setIsDanaSpeaking(false), 2500);
    return () => window.clearTimeout(timer);
  }, [voice.personaTranscripts, connected]);

  useEffect(() => {
    if (!voice.userTranscripts || !connected) {
      return;
    }
    setIsStudentSpeaking(true);
    const timer = window.setTimeout(() => setIsStudentSpeaking(false), 2000);
    return () => window.clearTimeout(timer);
  }, [voice.userTranscripts, connected]);

  const toggleMute = useCallback((): void => {
    if (micMuted) {
      void (async (): Promise<void> => {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const track = micStream.getAudioTracks()[0];
          if (!track) {
            micStream.getTracks().forEach((t) => t.stop());
            return;
          }
          const nextStream = new MediaStream([track]);
          activeAudioStreamRef.current = nextStream;
          isMutedRef.current = false;
          setMicMuted(false);
          voiceRef.current.resumeMic(nextStream);
        } catch {
          /* stay muted */
        }
      })();
      return;
    }

    isMutedRef.current = true;
    setMicMuted(true);
    activeAudioStreamRef.current.getAudioTracks().forEach((track) => track.stop());
    voiceRef.current.pauseMic();
  }, [micMuted]);

  const toggleCamera = useCallback((): void => {
    if (!cameraOff) {
      stopVideoTracks();
      return;
    }

    void (async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = stream.getVideoTracks()[0];
        if (!track) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const nextStream = new MediaStream([track]);
        activeVideoStreamRef.current = nextStream;
        setCameraOff(false);
        attachVideoPreview(nextStream);
      } catch {
        setCameraOff(true);
      }
    })();
  }, [cameraOff, stopVideoTracks, attachVideoPreview]);

  const handleEndCall = useCallback((): void => {
    const finalSeconds = secondsRef.current;
    voiceRef.current.endCall();
    activeAudioStreamRef.current.getTracks().forEach((track) => track.stop());
    activeVideoStreamRef.current?.getTracks().forEach((track) => track.stop());
    const raw = voiceRef.current.getFullTranscript();
    const entries = parseDiscoveryTranscript(raw, finalSeconds);
    onEnded(raw, finalSeconds, entries);
  }, [onEnded]);

  const showCameraPreview = !cameraOff;

  return (
    <TempoCallSessionShell
      connected={connected}
      isPersonaSpeaking={isDanaSpeaking}
      isStudentSpeaking={isStudentSpeaking}
      connectingMessage="Connecting to Dana Reyes…"
      statusText={voice.statusText}
      personaName="Dana Reyes"
      personaRole="Director of Operations"
      avatar={<Avatar ref={voice.avatarRef} />}
      studentVideoRef={studentVideoRef}
      showCameraPreview={showCameraPreview}
      micMuted={micMuted}
      cameraOff={cameraOff}
      formattedTime={formatDiscoveryTime(seconds)}
      onToggleMute={toggleMute}
      onToggleCamera={toggleCamera}
      onEndCall={handleEndCall}
    />
  );
}
