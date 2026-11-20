/**
 * DiscoveryCallSession.tsx
 * Anam video call for Tempo Stage 2 Discovery with Dana Reyes, in the in-call shell it
 * shares with Objection Handling (TempoCallSessionShell: video frame, PiP, speaking
 * rings, control bar). The call itself (connect on the microphone stream the student
 * enabled in the lobby, Dana's lines from the shared call brain, the clock, mute and
 * camera, the end) is hooks/useTempoCallSession.ts; the call ends with the brain's
 * endReason, or "student" from the end-call button.
 *
 * Avatar must stay mounted for the whole call (no remount on connect) — remounting
 * tears down the Anam WebRTC session and silences Dana.
 */

"use client";

import { Avatar } from "@/components/Avatar";
import { TempoCallSessionShell } from "@/components/tempo/stages/TempoCallSessionShell";
import { useTempoCallSession } from "@/hooks/useTempoCallSession";
import type { CallSessionEndReason } from "@/lib/call-config";
import type { DiscoveryTranscriptEntry } from "@/lib/tempo-discovery";

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
    entries: DiscoveryTranscriptEntry[],
    endReason: CallSessionEndReason
  ) => void;
};

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
  const call = useTempoCallSession({
    persona: "tempo_discovery",
    anamStage: "discovery",
    personaRole: "dana",
    connectErrorMessage: "Could not connect to Dana Reyes. Reload and try again.",
    attemptId,
    audioStream,
    videoStream,
    onActive,
    onError,
    onSecondsChange,
    onTranscriptChange,
    onEnded,
  });

  return (
    <TempoCallSessionShell
      {...call.shell}
      connectingMessage="Connecting to Dana Reyes…"
      personaName="Dana Reyes"
      personaRole="Director of Operations"
      avatar={<Avatar ref={call.avatarRef} />}
    />
  );
}
