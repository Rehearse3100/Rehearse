/**
 * DiscoveryLobby.tsx
 * Pre-call waiting room for Tempo Stage 2 Discovery — rendered as the center
 * column of the 3-column Discovery layout (same slot the call uses).
 * Only mounts after DiscoveryPreCallPrep is confirmed (gated in DiscoveryStage).
 * Renders the shared TempoCallLobby with the Discovery manager note
 * (lib/tempo-discovery.ts) and Discovery's camera message: the microphone and
 * camera are acquired only when the student clicks their buttons, and the streams
 * are handed to the call session on Join Call.
 */

"use client";

import { TempoCallLobby, type TempoJoinStreams } from "@/components/tempo/stages/TempoCallLobby";
import { DISCOVERY_MANAGER_NOTE } from "@/lib/tempo-discovery";

export type DiscoveryJoinStreams = TempoJoinStreams;

type DiscoveryLobbyProps = {
  connectError: string;
  onJoin: (streams: DiscoveryJoinStreams) => void;
  /** Server page boolean — shows Skip Call (test) without touching Anam. */
  testBypass?: boolean;
  onSkipCall?: () => void;
};

/** Discovery joins with audio only when the camera is blocked. */
const CAMERA_BLOCKED_MESSAGE = "Camera access was blocked. You can still join with audio only.";

/**
 * Center-column lobby: the Discovery manager note beside device setup and Join Call.
 */
export function DiscoveryLobby(props: DiscoveryLobbyProps): React.ReactElement {
  return (
    <TempoCallLobby
      {...props}
      managerNote={DISCOVERY_MANAGER_NOTE}
      cameraBlockedMessage={CAMERA_BLOCKED_MESSAGE}
    />
  );
}
