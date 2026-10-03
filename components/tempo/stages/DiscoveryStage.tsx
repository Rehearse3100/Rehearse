/**
 * DiscoveryStage.tsx
 * Stage 2 of the Tempo simulation — Discovery audio call with Dana Reyes.
 * Flow: pre-call OPC prep → lobby (DiscoveryLobby) → active audio call → auto-submit.
 * The microphone is enabled by the student in the lobby and handed to the call
 * session, so no device indicator turns on automatically.
 * Only used in the Tempo/Default simulation (Rehearse Essentials class).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HandoffModal } from "@/components/tempo/HandoffModal";
import { TempoTestBypassBanner } from "@/components/tempo/TempoTestBypassBanner";
import { DiscoveryCallSession } from "@/components/tempo/stages/DiscoveryCallSession";
import { DiscoveryLobby, type DiscoveryJoinStreams } from "@/components/tempo/stages/DiscoveryLobby";
import { DiscoveryPreCallPrep } from "@/components/tempo/stages/DiscoveryPreCallPrep";
import { DiscoveryStageLayout } from "@/components/tempo/stages/DiscoveryStageLayout";
import { DiscoveryTopBar } from "@/components/tempo/stages/DiscoveryTopBar";
import { resumePlaybackContext } from "@/lib/audio-playback";
import { completeStage } from "@/lib/attempt-actions";
import {
  clearDiscoveryPrepFromStorage,
  loadDiscoveryPrepFromStorage,
  saveDiscoveryPrepToStorage,
  type DiscoveryPhase,
  type DiscoveryPreCallPrep as DiscoveryPreCallPrepForm,
  type DiscoveryTranscriptEntry,
} from "@/lib/tempo-discovery";
import {
  TEMPO_HANDOFF_MESSAGES,
  TEMPO_HANDOFF_STAGE_META,
} from "@/lib/tempo-prospecting";
import { applyDiscoveryPrepAutofill } from "@/lib/tempo-test-bypass-client";

type DiscoveryStageProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  /** Show the manager handoff on mount (student has not clicked Begin Stage 2 yet). */
  initialShowHandoff?: boolean;
  /** Skip restoring local prep (Test → Discovery jumps). */
  resetStoredPrep?: boolean;
  /** Server page boolean from TEMPO_TEST_BYPASS_GATES — never from client env. */
  testBypass?: boolean;
};

/**
 * Tempo Discovery — OPC prep gate, lobby, audio call, then auto-complete on call end.
 */
export function DiscoveryStage({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  initialShowHandoff = false,
  resetStoredPrep = false,
  testBypass = false,
}: DiscoveryStageProps): React.ReactElement {
  const router = useRouter();
  const [phase, setPhase] = useState<DiscoveryPhase>("prep");
  const [prepForm, setPrepForm] = useState<DiscoveryPreCallPrepForm>(() => ({
    openQuestions: ["", "", ""],
    anticipatedProbe: "",
    anticipatedConfirm: "",
  }));
  const [prepReady, setPrepReady] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [callSeconds, setCallSeconds] = useState(0);
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);
  const [transcript, setTranscript] = useState<DiscoveryTranscriptEntry[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHandoff, setShowHandoff] = useState(initialShowHandoff);
  const [showPresentationHandoff, setShowPresentationHandoff] = useState(false);

  const submittingRef = useRef(false);
  const prepFormRef = useRef(prepForm);

  const discoveryMeta = TEMPO_HANDOFF_STAGE_META.discovery;
  const presentationMeta = TEMPO_HANDOFF_STAGE_META.presentation;

  useEffect(() => {
    let nextForm: DiscoveryPreCallPrepForm = {
      openQuestions: ["", "", ""],
      anticipatedProbe: "",
      anticipatedConfirm: "",
    };

    if (resetStoredPrep) {
      clearDiscoveryPrepFromStorage(attemptId);
    } else {
      const stored = loadDiscoveryPrepFromStorage(attemptId);
      if (stored) {
        nextForm = stored.form;
      }
    }

    if (testBypass) {
      nextForm = applyDiscoveryPrepAutofill(nextForm);
    }

    setPrepForm(nextForm);
    prepFormRef.current = nextForm;
    saveDiscoveryPrepToStorage(attemptId, nextForm, false);
    // Always land on the prep form when entering Discovery (restore draft fields).
    setPhase("prep");
    setPrepReady(true);
  }, [attemptId, resetStoredPrep, testBypass]);

  const handlePrepChange = useCallback(
    (next: DiscoveryPreCallPrepForm): void => {
      setPrepForm(next);
      prepFormRef.current = next;
      saveDiscoveryPrepToStorage(attemptId, next, false);
    },
    [attemptId]
  );

  const handlePrepBegin = useCallback((): void => {
    let next = prepFormRef.current;
    if (testBypass) {
      next = applyDiscoveryPrepAutofill(next);
      setPrepForm(next);
      prepFormRef.current = next;
    }
    saveDiscoveryPrepToStorage(attemptId, next, true);
    setPhase("lobby");
  }, [attemptId, testBypass]);

  const handleJoinCall = useCallback((streams: DiscoveryJoinStreams): void => {
    setConnectError("");
    setCallSeconds(0);
    setTranscript([]);
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
    setAudioStream(null);
    setVideoStream(null);
    setPhase("lobby");
  }, []);

  const handleCallEnded = useCallback(
    async (
      transcriptText: string,
      seconds: number,
      entries: DiscoveryTranscriptEntry[]
    ): Promise<void> => {
      if (submittingRef.current) {
        return;
      }
      submittingRef.current = true;

      setCallSeconds(seconds);
      setTranscript(entries);
      setAudioStream(null);
      setVideoStream(null);
      setPhase("summary");
      setIsSubmitting(true);

      try {
        const prep = prepFormRef.current;
        const payload = JSON.stringify({
          callDurationSeconds: seconds,
          transcript: transcriptText,
          transcriptEntries: entries,
          preCallPrep: {
            openQuestions: prep.openQuestions.filter((q) => q.trim().length > 0),
            anticipatedProbe: prep.anticipatedProbe,
            anticipatedConfirm: prep.anticipatedConfirm,
          },
        });

        await completeStage(attemptId, "discovery", 0, "Submitted — scoring coming soon", payload);
        setShowPresentationHandoff(true);
      } finally {
        setIsSubmitting(false);
        submittingRef.current = false;
      }
    },
    [attemptId]
  );

  const handlePresentationBegin = (): void => {
    window.location.assign(
      `/student/simulation/${simulationId}?classId=${classId}&attempt=${attemptId}`
    );
  };

  const handleSkipCall = useCallback((): void => {
    void handleCallEnded("[TEST] Skipped discovery call", 0, []);
  }, [handleCallEnded]);

  return (
    <>
      <TempoTestBypassBanner testBypass={testBypass} />
      <DiscoveryTopBar
        attemptId={attemptId}
        simulationId={simulationId}
        classId={classId}
        simulationTitle={simulationTitle}
        onOpenHandoff={() => setShowHandoff(true)}
        onBackToDashboard={() =>
          router.push(`/student/simulation/${simulationId}/entry?classId=${classId}`)
        }
      />

      {!prepReady ? (
        <div className="fixed inset-x-0 bottom-0 top-16 z-[45] flex items-center justify-center bg-surface">
          <p className="text-on-surface-variant font-body-md">Loading your plan...</p>
        </div>
      ) : (
        <ErrorBoundary stageName="discovery">
          <DiscoveryStageLayout
            phase={phase}
            callSeconds={callSeconds}
            referenceCollapsed={referenceCollapsed}
            onToggleReference={() => setReferenceCollapsed((prev) => !prev)}
            transcript={transcript}
            testBypass={testBypass}
            lobbySlot={
              phase === "prep" ? (
                <DiscoveryPreCallPrep
                  key="discovery-prep"
                  form={prepForm}
                  onChange={handlePrepChange}
                  onBegin={handlePrepBegin}
                  testBypass={testBypass}
                />
              ) : (
                <DiscoveryLobby
                  key="discovery-lobby"
                  connectError={connectError}
                  onJoin={handleJoinCall}
                  testBypass={testBypass}
                  onSkipCall={handleSkipCall}
                />
              )
            }
            callSlot={
              (phase === "connecting" || phase === "active") && audioStream ? (
                <DiscoveryCallSession
                  attemptId={attemptId}
                  audioStream={audioStream}
                  videoStream={videoStream}
                  onActive={handleCallActive}
                  onError={handleCallError}
                  onTranscriptChange={setTranscript}
                  onSecondsChange={setCallSeconds}
                  onEnded={(text, seconds, entries) => {
                    void handleCallEnded(text, seconds, entries);
                  }}
                />
              ) : null
            }
            isSubmitting={isSubmitting}
            nextStageName={presentationMeta.stageName}
            onContinueAfterCall={() => setShowPresentationHandoff(true)}
          />
        </ErrorBoundary>
      )}

      {showPresentationHandoff && (
        <HandoffModal
          stageNumber={presentationMeta.stageNumber}
          stageName={presentationMeta.stageName}
          stageIcon={presentationMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.presentation}
          hasAIRestriction={presentationMeta.hasAIRestriction}
          onBegin={handlePresentationBegin}
          onDismiss={() => setShowPresentationHandoff(false)}
          testBypass={testBypass}
        />
      )}

      {showHandoff && !showPresentationHandoff && (
        <HandoffModal
          stageNumber={discoveryMeta.stageNumber}
          stageName={discoveryMeta.stageName}
          stageIcon={discoveryMeta.stageIcon}
          message={TEMPO_HANDOFF_MESSAGES.discovery}
          hasAIRestriction={discoveryMeta.hasAIRestriction}
          onBegin={() => {
            setShowHandoff(false);
            void fetch("/api/student/discovery-handoff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attemptId }),
            }).catch(() => undefined);
          }}
          onDismiss={() => setShowHandoff(false)}
          testBypass={testBypass}
        />
      )}
    </>
  );
}
