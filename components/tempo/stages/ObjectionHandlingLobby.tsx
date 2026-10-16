/**
 * ObjectionHandlingLobby.tsx
 * Pre-call waiting room for Tempo Stage 4 — center column of the 3-column layout.
 * Renders the shared TempoCallLobby with the Objection Handling manager note
 * (lib/tempo-objections.ts) and this stage's camera message: mic and camera are
 * acquired only when the student toggles them (same as Stage 2 Discovery), and the
 * streams are handed to the video call session on Join Call.
 */

"use client";

import { TempoCallLobby, type TempoJoinStreams } from "@/components/tempo/stages/TempoCallLobby";
import { OBJECTION_MANAGER_NOTE } from "@/lib/tempo-objections";

export type ObjectionJoinStreams = TempoJoinStreams;

type ObjectionHandlingLobbyProps = {
  connectError: string;
  onJoin: (streams: ObjectionJoinStreams) => void;
  /** Server page boolean — shows Skip Call (test) without touching Anam. */
  testBypass?: boolean;
  onSkipCall?: () => void;
};

const CAMERA_BLOCKED_MESSAGE = "Camera access was blocked. Enable it for the video call PiP.";

/**
 * Center-column lobby: the Objection Handling manager note beside device setup and Join Call.
 */
export function ObjectionHandlingLobby(props: ObjectionHandlingLobbyProps): React.ReactElement {
  return (
    <TempoCallLobby
      {...props}
      managerNote={OBJECTION_MANAGER_NOTE}
      cameraBlockedMessage={CAMERA_BLOCKED_MESSAGE}
    />
  );
}
