/**
 * ObjectionHandlingStage.tsx
 * Stage 4 of the Tempo simulation — live Anam video call with Dr. Saul Kim.
 * Flow: pre-call lobby → active video call → auto-submit (no post-call form).
 * Objection tracker is live in-call feedback derived from the transcript.
 * Only used in the Tempo/Default simulation.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import {
  ObjectionHandlingCallSession,
} from "@/components/tempo/stages/ObjectionHandlingCallSession";
import {
  ObjectionHandlingLobby,
  type ObjectionJoinStreams,
} from "@/components/tempo/stages/ObjectionHandlingLobby";
import { ObjectionHandlingStageLayout } from "@/components/tempo/stages/ObjectionHandlingStageLayout";
import { ObjectionHandlingTopBar } from "@/components/tempo/stages/ObjectionHandlingTopBar";
import { resumePlaybackContext } from "@/lib/audio-playback";
import { completeStage } from "@/lib/attempt-actions";
import type { PresentationForm } from "@/lib/tempo-presentation";
import {
  EMPTY_TRACKER,
  type ObjectionHandlingPhase,
  type ObjectionTracker,
  type ObjectionTranscriptEntry,
} from "@/lib/tempo-objections";
import {
  TEMPO_HANDOFF_MESSAGES,
  TEMPO_HANDOFF_STAGE_META,
} from "@/lib/tempo-prospecting";

type ObjectionHandlingStageProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  presentationSummary: PresentationForm | null;
  /** Server page boolean from TEMPO_TEST_BYPASS_GATES — never from client env. */
  testBypass?: boolean;
};

/**
 * Tempo Objection Handling — lobby, video call, then auto-complete on call end.
 */
export function ObjectionHandlingStage({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  presentationSummary,
  testBypass = false,
}: ObjectionHandlingStageProps): React.ReactElement {
  const router = useRouter();
  const [phase, setPhase] = useState<ObjectionHandlingPhase>("lobby");
  const [connectError, setConnectError] = useState("");
  const [callSeconds, setCallSeconds] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [transcript, setTranscript] = useState<ObjectionTranscriptEntry[]>([]);
  const [objectionTracker, setObjectionTracker] = useState<ObjectionTracker>(EMPTY_TRACKER);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [showNegotiationHandoff, setShowNegotiationHandoff] = useState(false);

  const submittingRef = useRef(false);

  const objectionsMeta = TEMPO_HANDOFF_STAGE_META.objections;
  const negotiationMeta = TEMPO_HANDOFF_STAGE_META.negotiation;

  const handleJoinCall = useCallback((streams: ObjectionJoinStreams): void => {
    setConnectError("");
    setCallSeconds(0);
    setTranscript([]);
    setObjectionTracker(EMPTY_TRACKER);
    setAudioStream(streams.audioStream);
    setVideoStream(streams.videoStream);
    void resumePlaybackContext();
    setPhase("connecting");
  }, []);

  const handleCallActive = useCallback((): void => {
    setPhase("active");
  }, []);

  const handleCallError = useCallback((message: string): void => {
    setConnectError(message);
    setAudioStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setVideoStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setPhase("lobby");
  }, []);

  const handleCallEnded = useCallback(
    async (
      transcriptText: string,
      seconds: number,
      entries: ObjectionTranscriptEntry[],
      tracker: ObjectionTracker
    ): Promise<void> => {
      if (submittingRef.current) {
        return;
      }
      submittingRef.current = true;

      setCallSeconds(seconds);
      setTranscript(entries);
      setObjectionTracker(tracker);
      setAudioStream(null);
      setVideoStream(null);
      setPhase("summary");
      setIsSubmitting(true);

      try {
        const payload = JSON.stringify({
          callDurationSeconds: seconds,
          transcript: transcriptText,
          transcriptEntries: entries,
          objectionTracker: tracker,
        });

        await completeStage(attemptId, "objections", 0, "Submitted — scoring coming soon", payload);
        setShowNegotiationHandoff(true);
      } finally {
        setIsSubmitting(false);
        submittingRef.current = false;
      }
    },
    [attemptId]
  );

  const handleNegotiationBegin = (): void => {
    window.location.assign(
      `/student/simulation/${simulationId}?classId=${classId}&attempt=${attemptId}`
    );
  };

  const handleSkipCall = useCallback((): void => {
    void handleCallEnded("[TEST] Skipped objections call", 0, [], EMPTY_TRACKER);
  }, [handleCallEnded]);

  return (
    <>
      <TempoTestBypassBanner testBypass={testBypass} />
      <ObjectionHandlingTopBar
        attemptId={attemptId}
        simulationId={simulationId}
        classId={classId}
        simulationTitle={simulationTitle}
        onOpenHandoff={() => setShowHandoff(true)}
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
      />

      <ErrorBoundary stageName="objections">
        <ObjectionHandlingStageLayout
          phase={phase}
          callSeconds={callSeconds}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          transcript={transcript}
          objectionTracker={objectionTracker}
          presentationSummary={presentationSummary}
          testBypass={testBypass}
          lobbySlot={
            <ObjectionHandlingLobby
              connectError={connectError}
              onJoin={handleJoinCall}
              testBypass={testBypass}
              onSkipCall={handleSkipCall}
            />
          }
          callSlot={
            (phase === "connecting" || phase === "active") && audioStream ? (
                <ObjectionHandlingCallSession
                  attemptId={attemptId}
                  audioStream={audioStream}
                videoStream={videoStream}
                onActive={handleCallActive}
                onError={handleCallError}
                onTranscriptChange={setTranscript}
                onTrackerChange={setObjectionTracker}
                onSecondsChange={setCallSeconds}
                onEnded={(text, seconds, entries, tracker) => {
                  void handleCallEnded(text, seconds, entries, tracker);
                }}
              />
            ) : null
          }
          isSubmitting={isSubmitting}
          nextStageName={negotiationMeta.stageName}
          onContinueAfterCall={() => setShowNegotiationHandoff(true)}
        />
      </ErrorBoundary>

      {showNegotiationHandoff && (
        <HandoffModal
          stageNumber={negotiationMeta.stageNumber}
          stageName={negotiationMeta.stageName}
          stageIcon={negotiationMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.negotiation}
          hasAIRestriction={negotiationMeta.hasAIRestriction}
          onBegin={handleNegotiationBegin}
          onDismiss={() => setShowNegotiationHandoff(false)}
          testBypass={testBypass}
        />
      )}

      {showHandoff && !showNegotiationHandoff && (
        <HandoffModal
          stageNumber={objectionsMeta.stageNumber}
          stageName={objectionsMeta.stageName}
          stageIcon={objectionsMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.objections}
          hasAIRestriction={objectionsMeta.hasAIRestriction}
          onBegin={() => setShowHandoff(false)}
          onDismiss={() => setShowHandoff(false)}
          testBypass={testBypass}
        />
      )}
    </>
  );
}
