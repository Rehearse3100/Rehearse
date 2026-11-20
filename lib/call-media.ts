/**
 * call-media.ts
 * Small browser helpers shared by the live call screens: waiting for the Avatar's
 * imperative handle and video element (hooks/useTempoCallSession.ts for the Tempo Dana
 * and Dr. Kim calls, components/call/AvatarCallStage.tsx for legacy simulations), and
 * checking a camera stream for a live video track. Client only; no network.
 */

import type { AvatarRef } from "@/types";

/** The longest waitForAvatarReady waits by default. */
const AVATAR_READY_WAIT_MS = 8000;
/** How long each check waits for the Avatar's video element. */
const MEDIA_ELEMENTS_WAIT_MS = 2000;
/** The pause between checks. */
const AVATAR_RETRY_DELAY_MS = 100;

/**
 * Waits until the Avatar's imperative handle and media elements are ready.
 * @param getRef - Reads the Avatar ref (set once the Avatar has mounted)
 * @param maxMs - The longest wait (8 s by default)
 * @returns The Avatar once its video element is there; after maxMs, whatever the ref holds (possibly null)
 */
export async function waitForAvatarReady(
  getRef: () => AvatarRef | null,
  maxMs = AVATAR_READY_WAIT_MS
): Promise<AvatarRef | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const avatar = getRef();
    if (avatar) {
      const domReady = await avatar.waitForMediaElements(MEDIA_ELEMENTS_WAIT_MS);
      if (domReady) {
        return avatar;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, AVATAR_RETRY_DELAY_MS));
  }
  return getRef();
}

/**
 * True when the stream has at least one live video track.
 * @param stream - A camera stream, or none
 */
export function hasLiveVideoTrack(stream: MediaStream | null | undefined): boolean {
  return Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));
}
