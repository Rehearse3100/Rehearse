/**
 * useTempoCallSession.ts
 * The logic the live Tempo calls share, Dana (DiscoveryCallSession) and Dr. Kim
 * (ObjectionHandlingCallSession): the voice hook on the shared call brain, the connect
 * on mount with the microphone stream the student enabled in the lobby, the student's
 * camera preview, the speaking rings, mute and camera, the live transcript bubbled up,
 * and the call's end, once (the brain's endReason through onCallEnd, or "student" from
 * the end-call button). Returns what TempoCallSessionShell renders; each session adds
 * its persona's name, role, connecting line and the Avatar, and its own extras (the
 * objection tracker).
 *
 * Mute is Anam's own input mute (the voice hook's pauseMic / resumeMic, the Avatar's
 * setInputMuted): the lobby's echo-cancelled mic stream stays the call's input, so
 * unmuting needs no new microphone stream. The camera button still stops the camera
 * and asks for a new one.
 */

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TempoCallSessionShellProps } from "@/components/tempo/stages/TempoCallSessionShell";
import { useSimulationVoiceSession } from "@/hooks/useSimulationVoiceSession";
import { resumePlaybackContext } from "@/lib/audio-playback";
import { formatClock } from "@/lib/call-clock";
import type { CallPersona, CallSessionEndReason } from "@/lib/call-config";
import { hasLiveVideoTrack, waitForAvatarReady } from "@/lib/call-media";
import type { AnamSessionStage } from "@/lib/tempo-anam-config";
import { parseCallTranscript, type CallTranscriptEntry } from "@/lib/tempo-call-transcript";
import type { AvatarRef } from "@/types";

/** How long the persona's speaking ring stays on after a new line. */
const PERSONA_SPEAKING_RING_MS = 2500;
/** How long the student's speaking ring stays on after a new line. */
const STUDENT_SPEAKING_RING_MS = 2000;

export type TempoCallSessionOptions<PersonaRole extends string> = {
  /** Who the call is with; the server builds the persona's lines from this key. */
  persona: CallPersona;
  anamStage: AnamSessionStage;
  /** The persona's role in the transcript entries ("dana", "drKim"). */
  personaRole: PersonaRole;
  /** Shown when the avatar doesn't come up. */
  connectErrorMessage: string;
  attemptId: string;
  /** The microphone stream from the lobby (the call's input for the whole call). */
  audioStream: MediaStream;
  videoStream: MediaStream | null;
  onActive: () => void;
  onError: (message: string) => void;
  onSecondsChange: (seconds: number) => void;
  onTranscriptChange: (entries: CallTranscriptEntry<PersonaRole>[]) => void;
  onEnded: (
    transcriptText: string,
    seconds: number,
    entries: CallTranscriptEntry<PersonaRole>[],
    endReason: CallSessionEndReason
  ) => void;
};

/** The shell props this hook fills; the session adds the persona's lines and the Avatar. */
export type TempoCallShellState = Omit<
  TempoCallSessionShellProps,
  "connectingMessage" | "personaName" | "personaRole" | "avatar"
>;

export type TempoCallSession = {
  /** For the session's <Avatar ref={…} />. */
  avatarRef: React.RefObject<AvatarRef>;
  shell: TempoCallShellState;
};

/**
 * Runs one live Tempo call: connects on mount, then keeps the shell's state.
 * @param options - The persona, the lobby's streams, the error copy and the session's callbacks
 * @returns The Avatar ref and the shell's props
 */
export function useTempoCallSession<PersonaRole extends string>({
  persona,
  anamStage,
  personaRole,
  connectErrorMessage,
  attemptId,
  audioStream,
  videoStream,
  onActive,
  onError,
  onSecondsChange,
  onTranscriptChange,
  onEnded,
}: TempoCallSessionOptions<PersonaRole>): TempoCallSession {
  const [connected, setConnected] = useState(false);
  const [isPersonaSpeaking, setIsPersonaSpeaking] = useState(false);
  const [isStudentSpeaking, setIsStudentSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(() => !hasLiveVideoTrack(videoStream));

  const connectStartedRef = useRef(false);
  /** The voice hook's mute flag (pauseMic and resumeMic keep it). */
  const isMutedRef = useRef(false);
  const hasEndedRef = useRef(false);
  const studentVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeVideoStreamRef = useRef<MediaStream | null>(videoStream);
  /** handleEndCall, for the voice hook's onCallEnd (the hook is set up before handleEndCall exists). */
  const handleEndCallRef = useRef<(endReason: CallSessionEndReason) => void>(() => undefined);

  const voice = useSimulationVoiceSession({
    persona,
    isMutedRef,
    attemptId,
    anamStage,
    // The brain ended the call and the persona's reply has been spoken: end it as the button does.
    onCallEnd: (endReason) => handleEndCallRef.current(endReason),
  });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const callbacksRef = useRef({ onActive, onError, connectErrorMessage });
  callbacksRef.current = { onActive, onError, connectErrorMessage };

  // ── Student PiP video ───
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
        callbacksRef.current.onError(callbacksRef.current.connectErrorMessage);
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

  // ── Call time (the voice hook's call clock) ───
  useEffect(() => {
    onSecondsChange(voice.callSeconds);
  }, [voice.callSeconds, onSecondsChange]);

  // ── Bubble live transcript up to parent ───
  useEffect(() => {
    if (!connected) {
      return;
    }
    const raw = voiceRef.current.getFullTranscript();
    onTranscriptChange(parseCallTranscript(raw, voiceRef.current.callSeconds, personaRole));
  }, [voice.userTranscripts, voice.personaTranscripts, connected, onTranscriptChange, personaRole]);

  // ── Speaking indicators ───
  useEffect(() => {
    if (!voice.personaTranscripts || !connected) {
      return;
    }
    setIsPersonaSpeaking(true);
    const timer = window.setTimeout(() => setIsPersonaSpeaking(false), PERSONA_SPEAKING_RING_MS);
    return () => window.clearTimeout(timer);
  }, [voice.personaTranscripts, connected]);

  useEffect(() => {
    if (!voice.userTranscripts || !connected) {
      return;
    }
    setIsStudentSpeaking(true);
    const timer = window.setTimeout(() => setIsStudentSpeaking(false), STUDENT_SPEAKING_RING_MS);
    return () => window.clearTimeout(timer);
  }, [voice.userTranscripts, connected]);

  // ── Mute and camera ───
  // Anam's input mute on the lobby's stream: no tracks stopped, no new microphone stream.
  const toggleMute = useCallback((): void => {
    if (micMuted) {
      setMicMuted(false);
      voiceRef.current.resumeMic();
      return;
    }
    setMicMuted(true);
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

  // ── The call's end ───
  const handleEndCall = useCallback(
    (endReason: CallSessionEndReason): void => {
      // Once only: the button and the brain's endCall can both end the call.
      if (hasEndedRef.current) {
        return;
      }
      hasEndedRef.current = true;
      const finalSeconds = voiceRef.current.callSeconds;
      voiceRef.current.endCall();
      audioStream.getTracks().forEach((track) => track.stop());
      activeVideoStreamRef.current?.getTracks().forEach((track) => track.stop());
      const raw = voiceRef.current.getFullTranscript();
      onEnded(raw, finalSeconds, parseCallTranscript(raw, finalSeconds, personaRole), endReason);
    },
    [audioStream, onEnded, personaRole]
  );

  handleEndCallRef.current = handleEndCall;

  /** The end-call button: stops at once. */
  const handleEndCallButton = useCallback((): void => {
    handleEndCall("student");
  }, [handleEndCall]);

  return {
    avatarRef: voice.avatarRef,
    shell: {
      connected,
      isPersonaSpeaking,
      isStudentSpeaking,
      statusText: voice.statusText,
      studentVideoRef,
      showCameraPreview: !cameraOff,
      micMuted,
      cameraOff,
      formattedTime: formatClock(voice.callSeconds),
      onToggleMute: toggleMute,
      onToggleCamera: toggleCamera,
      onEndCall: handleEndCallButton,
    },
  };
}
