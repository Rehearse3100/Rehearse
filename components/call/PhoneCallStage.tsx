/**
 * PhoneCallStage.tsx
 * Prospecting flow: lobby → connect → active phone UI → score (no avatar video, no camera).
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { EndCallModal } from "@/components/call/EndCallModal";
import { PhoneCallLayout } from "@/components/call/PhoneCallLayout";
import { PhoneCallLobby } from "@/components/call/PhoneCallLobby";
import { StageScoreReveal } from "@/components/StageScoreReveal";
import { resumePlaybackContext } from "@/lib/audio-playback";
import { CALL_SCORE_DELAY_MS } from "@/lib/constants";
import { useAudioWaveform } from "@/hooks/useAudioWaveform";
import { useProspectingVoice } from "@/hooks/useProspectingVoice";
import { useVideoCall } from "@/hooks/useVideoCall";
import { completeStage, fetchStageScore } from "@/lib/attempt-actions";
import { parseLegacyChatStage } from "@/lib/chat-personas";
import type { Simulation, SimulationStage } from "@/types";

type PhonePhase = "lobby" | "connecting" | "active" | "scoring" | "scored";

type PhoneCallStageProps = {
  simulation: Simulation;
  attemptId: string;
  openingGreeting?: string;
  onAdvance: () => void;
  /** UI stage badge — defaults to prospecting. */
  callStage?: SimulationStage;
  /** Stage saved to stage_scores — defaults to prospecting. */
  scoreStage?: SimulationStage;
  runningTotalScore?: number;
  priorStagesSummary?: string;
  scoreTranscriptExtra?: string;
  advanceLabel?: string;
};

/**
 * Orchestrates the voice-only phone-call experience end to end.
 */
export function PhoneCallStage({
  simulation,
  attemptId,
  openingGreeting,
  onAdvance,
  callStage = "prospecting",
  scoreStage = "prospecting",
  runningTotalScore = 0,
  priorStagesSummary,
  scoreTranscriptExtra = "",
  advanceLabel = "Next Stage →",
}: PhoneCallStageProps): React.ReactElement {
  const [phase, setPhase] = useState<PhonePhase>("lobby");
  const [showEndModal, setShowEndModal] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [score, setScore] = useState<number | undefined>();
  const [feedback, setFeedback] = useState<string | undefined>();
  const [scoreError, setScoreError] = useState("");
  const { showToast } = useToast();

  const videoCall = useVideoCall({ withVideo: false });
  const getAudioStreamRef = useRef(videoCall.getAudioStream);
  getAudioStreamRef.current = videoCall.getAudioStream;

  // The simulation's own persona, built on the server with this call stage's hint.
  const voice = useProspectingVoice({
    attemptId,
    persona: "simulation",
    chatStage: parseLegacyChatStage(callStage) ?? undefined,
    personaName: simulation.persona_name,
    openingGreeting,
    isMutedRef: videoCall.isMutedRef,
  });

  const { levels } = useAudioWaveform(
    phase === "active" ? videoCall.getAudioStream() : null
  );

  const context = {
    personaName: simulation.persona_name,
    personaRole: simulation.persona_role,
    personaSystemPrompt: simulation.persona_system_prompt,
    productContext: simulation.product_context,
    productName: simulation.title,
  };

  const handleJoinCall = useCallback((): void => {
    if (!videoCall.canJoin) {
      return;
    }

    void (async (): Promise<void> => {
      setConnectError("");
      setPhase("connecting");
      try {
        await resumePlaybackContext();
        const audioStream = getAudioStreamRef.current();
        if (!audioStream) {
          setConnectError("Microphone unavailable. Reload and allow mic access.");
          setPhase("lobby");
          return;
        }
        await voice.startCall(audioStream);
        videoCall.startTimer();
        setPhase("active");
      } catch (err) {
        setConnectError(
          err instanceof Error ? err.message : "Could not start call. Check Deepgram API key."
        );
        setPhase("lobby");
      }
    })();
  }, [videoCall.canJoin, videoCall.startTimer, voice]);

  const runScoring = useCallback(async (): Promise<void> => {
    setPhase("scoring");
    setScoreError("");
    const transcript = voice.getFullTranscript();

    await new Promise<void>((r) => setTimeout(r, CALL_SCORE_DELAY_MS));

    try {
      const transcript = voice.getFullTranscript();
      const fullTranscript = scoreTranscriptExtra
        ? `${transcript}\n\n${scoreTranscriptExtra}`
        : transcript;

      const result = await fetchStageScore({
        stage: scoreStage,
        transcript: fullTranscript,
        priorStagesSummary,
        simulationContext: context,
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
    }
  }, [
    voice,
    attemptId,
    context,
    showToast,
    scoreStage,
    scoreTranscriptExtra,
    priorStagesSummary,
    runningTotalScore,
  ]);

  const handleConfirmEndCall = useCallback((): void => {
    setShowEndModal(false);
    voice.endCall();
    videoCall.stopTimer();
    videoCall.stopAllTracks();
    void runScoring();
  }, [voice, videoCall, runScoring]);

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

  if (phase === "connecting") {
    return (
      <div className="call-screen-root items-center justify-center">
        <div className="flex flex-col items-center justify-center flex-1 px-6 text-center">
          <div className="w-10 h-10 border-2 border-white/20 border-t-success rounded-full animate-spin" />
          <p className="mt-4 text-sm text-white/70">Calling {simulation.persona_name}…</p>
          {voice.statusText.length > 0 && (
            <p className="mt-2 text-xs text-white/50">{voice.statusText}</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === "active") {
    return (
      <div className="call-screen-root">
        {showEndModal && (
          <EndCallModal
            personaName={simulation.persona_name}
            onConfirm={handleConfirmEndCall}
            onCancel={() => setShowEndModal(false)}
          />
        )}
        <PhoneCallLayout
          stage={callStage}
          personaName={simulation.persona_name}
          personaRole={simulation.persona_role}
          formattedTimer={videoCall.formattedTimer}
          waveformLevels={levels}
          userTranscripts={voice.userTranscripts}
          personaTranscripts={voice.personaTranscripts}
          isMuted={videoCall.isMuted}
          onToggleMute={videoCall.toggleMute}
          onEndCall={() => setShowEndModal(true)}
        />
        {voice.statusText.length > 0 && (
          <p className="absolute top-14 left-4 z-30 text-xs text-white/60">{voice.statusText}</p>
        )}
      </div>
    );
  }

  return (
    <div className="call-screen-root">
      {connectError.length > 0 && (
        <p className="text-sm text-error px-4 py-2 shrink-0">{connectError}</p>
      )}
      <PhoneCallLobby
        personaName={simulation.persona_name}
        personaRole={simulation.persona_role}
        permissionError={videoCall.permissionError}
        canJoin={videoCall.canJoin}
        isPermissionPending={videoCall.permissionState === "pending"}
        onJoinCall={handleJoinCall}
      />
    </div>
  );
}
