/**
 * AvatarCallStage.tsx
 * Orchestrates lobby → Anam connect → active call → score for Discovery and Objections.
 * Avatar mounts once after Join Call and is not remounted until the call ends.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { Avatar } from "@/components/Avatar";
import { CallLayout, CALL_VIDEO_BOTTOM_DOCK_PX } from "@/components/call/CallLayout";
import { CallLobby } from "@/components/call/CallLobby";
import { EndCallModal } from "@/components/call/EndCallModal";
import { StageScoreReveal } from "@/components/StageScoreReveal";
import { resumePlaybackContext } from "@/lib/audio-playback";
import { completeStage, fetchStageScore } from "@/lib/attempt-actions";
import { CALL_SCORE_DELAY_MS } from "@/lib/constants";
import { getStageCallLabel } from "@/lib/stages";
import { useSimulationVoiceSession } from "@/hooks/useSimulationVoiceSession";
import { useVideoCall } from "@/hooks/useVideoCall";
import type { AvatarRef, Simulation, SimulationStage } from "@/types";

type CallPhase = "lobby" | "connecting" | "active" | "scoring" | "scored";

type AvatarCallStageProps = {
  simulation: Simulation;
  attemptId: string;
  stage: SimulationStage;
  openingGreeting: string;
  scoreStage: "discovery" | "objections";
  runningTotalScore?: number;
  scoreTranscriptExtra?: string;
  priorStagesSummary?: string;
  advanceLabel: string;
  onAdvance: () => void;
  /** Optional banner above the call UI (e.g. objections instructions). */
  topBanner?: React.ReactNode;
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

/**
 * Shared video-call flow for Anam-powered Discovery and Objections stages.
 */
export function AvatarCallStage({
  simulation,
  attemptId,
  stage,
  openingGreeting,
  scoreStage,
  runningTotalScore = 0,
  scoreTranscriptExtra = "",
  priorStagesSummary,
  advanceLabel,
  onAdvance,
  topBanner,
}: AvatarCallStageProps): React.ReactElement {
  const [phase, setPhase] = useState<CallPhase>("lobby");
  const [mountAvatar, setMountAvatar] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [score, setScore] = useState<number | undefined>();
  const [feedback, setFeedback] = useState<string | undefined>();
  const [scoreError, setScoreError] = useState("");
  const { showToast } = useToast();
  const videoCall = useVideoCall({
    withVideo: true,
    onAudioStreamReplace: (stream) => voiceRef.current.replaceAudioStream(stream),
  });
  const connectStartedRef = useRef(false);
  const getAudioStreamRef = useRef(videoCall.getAudioStream);
  const primeUserGestureRef = useRef(videoCall.primeUserGesture);

  getAudioStreamRef.current = videoCall.getAudioStream;
  primeUserGestureRef.current = videoCall.primeUserGesture;

  // The simulation's own persona, built on the server with this stage's hint.
  const voice = useSimulationVoiceSession({
    persona: "simulation",
    chatStage: scoreStage,
    openingGreeting,
    isMutedRef: videoCall.isMutedRef,
    attemptId,
    anamStage: scoreStage,
  });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const stageLabel = getStageCallLabel(stage);

  const handleJoinCall = useCallback((): void => {
    if (!videoCall.canJoin) {
      return;
    }

    setConnectError("");
    connectStartedRef.current = false;

    void (async (): Promise<void> => {
      await resumePlaybackContext();
      await primeUserGestureRef.current();
      setMountAvatar(true);
      setPhase("connecting");
    })();
  }, [videoCall.canJoin]);

  useEffect(() => {
    if (phase !== "connecting" || !mountAvatar || connectStartedRef.current) {
      return;
    }

    const run = async (): Promise<void> => {
      connectStartedRef.current = true;

      const avatar = await waitForAvatarReady(() => voiceRef.current.avatarRef.current);
      if (!avatar) {
        setConnectError(
          `Could not connect to ${simulation.persona_name}. Reload and try again.`
        );
        setMountAvatar(false);
        setPhase("lobby");
        connectStartedRef.current = false;
        return;
      }

      avatar.resumeAudioContext();

      const avatarReady = await avatar.startSession();
      if (!avatarReady) {
        setConnectError(
          `Could not connect to ${simulation.persona_name} in time. Check Anam configuration and try again.`
        );
        setMountAvatar(false);
        setPhase("lobby");
        connectStartedRef.current = false;
        return;
      }

      const audioStream = getAudioStreamRef.current();
      if (!audioStream || audioStream.getAudioTracks().length === 0) {
        setConnectError("Microphone stream unavailable. Reload and try again.");
        setMountAvatar(false);
        setPhase("lobby");
        connectStartedRef.current = false;
        return;
      }

      try {
        await voiceRef.current.startCall(audioStream);
        await primeUserGestureRef.current();
        videoCall.startTimer();
        setPhase("active");
      } catch {
        setConnectError("Could not start voice session. Reload and try again.");
        setMountAvatar(false);
        setPhase("lobby");
        connectStartedRef.current = false;
      }
    };

    void run();
  }, [phase, mountAvatar, simulation.persona_name, videoCall.startTimer]);

  const runScoring = useCallback(async (): Promise<void> => {
    setPhase("scoring");
    setScoreError("");
    const transcript = voiceRef.current.getFullTranscript();
    const fullTranscript = scoreTranscriptExtra
      ? `${transcript}\n\n${scoreTranscriptExtra}`
      : transcript;

    await new Promise<void>((r) => setTimeout(r, CALL_SCORE_DELAY_MS));

    try {
      const result = await fetchStageScore({
        stage: scoreStage,
        transcript: fullTranscript,
        priorStagesSummary,
        simulationContext: {
          personaName: simulation.persona_name,
          personaRole: simulation.persona_role,
          personaSystemPrompt: simulation.persona_system_prompt,
          productContext: simulation.product_context,
          productName: simulation.title,
        },
        runningTotalScore,
      });
      setScore(result.score);
      setFeedback(result.feedback);
      await completeStage(
        attemptId,
        scoreStage,
        result.score,
        result.feedback,
        fullTranscript
      );
      setPhase("scored");
      showToast("Stage complete — score saved", "success");
    } catch (err) {
      showToast("Something went wrong. Please try again.", "error");
      setScoreError(err instanceof Error ? err.message : "Scoring failed");
      setPhase("active");
      setMountAvatar(true);
    }
  }, [
    scoreTranscriptExtra,
    priorStagesSummary,
    scoreStage,
    runningTotalScore,
    attemptId,
    simulation,
    showToast,
  ]);

  const handleConfirmEndCall = useCallback((): void => {
    setShowEndModal(false);
    voice.endCall();
    setMountAvatar(false);
    videoCall.stopTimer();
    videoCall.stopAllTracks();
    void runScoring();
  }, [voice, videoCall, runScoring]);

  const showStudentPip =
    videoCall.permissionState === "ready" && !videoCall.cameraUnavailable;

  if (phase === "scored" && score !== undefined && feedback) {
    return (
      <div className="call-screen-root">
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-call-background">
          <div className="stage-content-card max-w-lg w-full">
            <StageScoreReveal
              score={score}
              feedback={feedback}
              advanceLabel={advanceLabel}
              onAdvance={onAdvance}
            />
            {scoreError.length > 0 && <p className="text-sm text-error mt-4">{scoreError}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "scoring") {
    return (
      <div className="call-screen-root items-center justify-center">
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="w-10 h-10 border-2 border-white/20 border-t-success rounded-full animate-spin" />
          <p className="mt-4 text-sm text-white/70">Scoring your conversation…</p>
        </div>
      </div>
    );
  }

  if (phase === "lobby") {
    return (
      <div className="call-screen-root flex h-full min-h-0 flex-1 flex-col rounded-none bg-[#f9f9ff] text-[#111c2d]">
        {topBanner}
        {connectError.length > 0 && (
          <p className="shrink-0 px-4 py-2 text-sm text-error">{connectError}</p>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <CallLobby
            stageLabel={stageLabel}
            personaName={simulation.persona_name}
            personaRole={simulation.persona_role}
            permissionError={videoCall.permissionError}
            canJoin={videoCall.canJoin}
            isPermissionPending={videoCall.permissionState === "pending"}
            studentVideoRef={videoCall.studentVideoRef}
            showStudentPip={showStudentPip}
            cameraUnavailable={videoCall.cameraUnavailable}
            micReady={videoCall.permissionState === "ready"}
            cameraReady={showStudentPip}
            isMuted={videoCall.isMuted}
            isCameraOff={videoCall.isCameraOff}
            onToggleMute={videoCall.toggleMute}
            onToggleCamera={videoCall.toggleCamera}
            onJoinCall={handleJoinCall}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="call-screen-root relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {topBanner}

      {connectError.length > 0 && (
        <p className="absolute top-2 left-4 right-4 z-40 text-sm text-error bg-black/70 rounded px-3 py-2">
          {connectError}
        </p>
      )}

      {mountAvatar && (
        <div className="absolute inset-0 z-0" style={{ "--call-video-dock-h": `${CALL_VIDEO_BOTTOM_DOCK_PX}px` } as React.CSSProperties}>
          <Avatar ref={voice.avatarRef} />
        </div>
      )}

      {phase === "connecting" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-call-background/80">
          <div className="w-10 h-10 border-2 border-white/20 border-t-success rounded-full animate-spin" />
          <p className="mt-4 text-sm text-white/70">
            Connecting to {simulation.persona_name}…
          </p>
          {voice.statusText.length > 0 && (
            <p className="mt-2 text-xs text-white/50 max-w-sm text-center px-4">
              {voice.statusText}
            </p>
          )}
        </div>
      )}

      {phase === "active" && (
        <>
          {showEndModal && (
            <EndCallModal
              personaName={simulation.persona_name}
              onConfirm={handleConfirmEndCall}
              onCancel={() => setShowEndModal(false)}
            />
          )}
          <CallLayout
            stageLabel={stageLabel}
            formattedTimer={videoCall.formattedTimer}
            personaName={simulation.persona_name}
            statusText={voice.statusText}
            studentVideoRef={videoCall.studentVideoRef}
            showStudentPip={showStudentPip}
            cameraUnavailable={videoCall.cameraUnavailable}
            isMuted={videoCall.isMuted}
            isCameraOff={videoCall.isCameraOff}
            userTranscripts={voice.userTranscripts}
            personaTranscripts={voice.personaTranscripts}
            onToggleMute={videoCall.toggleMute}
            onToggleCamera={videoCall.toggleCamera}
            onEndCall={() => setShowEndModal(true)}
          />
          {scoreError.length > 0 && (
            <p className="absolute bottom-2 left-4 z-30 text-sm text-error">{scoreError}</p>
          )}
        </>
      )}
    </div>
  );
}
