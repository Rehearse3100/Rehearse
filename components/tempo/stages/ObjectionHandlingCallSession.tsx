/**
 * ObjectionHandlingCallSession.tsx
 * Anam video call for Tempo Stage 4 with Dr. Saul Kim, in the in-call shell it shares
 * with Discovery (TempoCallSessionShell: video frame, PiP, speaking rings, control bar).
 * The call itself (connect on the lobby's microphone stream, Dr. Kim's lines from the
 * shared call brain, the clock, mute and camera, the end) is hooks/useTempoCallSession.ts;
 * this session adds the objection tracker, derived from the transcript live and at the
 * end. The call ends with the brain's endReason, or "student" from the end-call button.
 */

"use client";

import { useCallback } from "react";
import { Avatar } from "@/components/Avatar";
import { TempoCallSessionShell } from "@/components/tempo/stages/TempoCallSessionShell";
import { useTempoCallSession } from "@/hooks/useTempoCallSession";
import type { CallSessionEndReason } from "@/lib/call-config";
import {
  deriveObjectionTracker,
  type ObjectionTracker,
  type ObjectionTranscriptEntry,
} from "@/lib/tempo-objections";

type ObjectionHandlingCallSessionProps = {
  attemptId: string;
  audioStream: MediaStream;
  videoStream: MediaStream | null;
  onActive: () => void;
  onError: (message: string) => void;
  onTranscriptChange: (entries: ObjectionTranscriptEntry[]) => void;
  onTrackerChange: (tracker: ObjectionTracker) => void;
  onSecondsChange: (seconds: number) => void;
  onEnded: (
    transcriptText: string,
    seconds: number,
    entries: ObjectionTranscriptEntry[],
    tracker: ObjectionTracker,
    endReason: CallSessionEndReason
  ) => void;
};

/**
 * Mounts Anam voice session with visible video avatar and student PiP.
 */
export function ObjectionHandlingCallSession({
  attemptId,
  audioStream,
  videoStream,
  onActive,
  onError,
  onTranscriptChange,
  onTrackerChange,
  onSecondsChange,
  onEnded,
}: ObjectionHandlingCallSessionProps): React.ReactElement {
  // ── Live transcript + objection tracker ───
  const handleTranscriptChange = useCallback(
    (entries: ObjectionTranscriptEntry[]): void => {
      onTranscriptChange(entries);
      onTrackerChange(deriveObjectionTracker(entries));
    },
    [onTranscriptChange, onTrackerChange]
  );

  const handleEnded = useCallback(
    (
      transcriptText: string,
      seconds: number,
      entries: ObjectionTranscriptEntry[],
      endReason: CallSessionEndReason
    ): void => {
      onEnded(transcriptText, seconds, entries, deriveObjectionTracker(entries), endReason);
    },
    [onEnded]
  );

  const call = useTempoCallSession({
    persona: "tempo_objections",
    anamStage: "objections",
    personaRole: "drKim",
    connectErrorMessage: "Could not connect to Dr. Kim. Reload and try again.",
    attemptId,
    audioStream,
    videoStream,
    onActive,
    onError,
    onSecondsChange,
    onTranscriptChange: handleTranscriptChange,
    onEnded: handleEnded,
  });

  return (
    <TempoCallSessionShell
      {...call.shell}
      connectingMessage="Connecting to Dr. Saul Kim…"
      personaName="Dr. Saul Kim"
      personaRole="Founder & Owner"
      avatar={<Avatar ref={call.avatarRef} />}
    />
  );
}
