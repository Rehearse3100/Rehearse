/**
 * tempo-post-call.ts
 * What the Discovery and Objection Handling post-call screens show once a call has ended:
 * the 988 notice (CallCrisisNotice, only when the call brain ended the call for a crisis)
 * and the next stage's manager handoff pop-up. The notice comes first: after a crisis
 * ending the pop-up never opens over it on its own; it opens when the student dismisses
 * the notice (at once if the stage is already saved, otherwise when the save finishes)
 * or presses Submit. After any other ending the pop-up opens as soon as the stage is
 * saved, as before. A pure reducer for useReducer in DiscoveryStage and
 * ObjectionHandlingStage.
 */

import type { CallSessionEndReason } from "@/lib/call-config";

export type PostCallState = {
  /** The 988 notice is showing: a crisis ending the student hasn't dismissed yet. */
  isCrisisNoticeOpen: boolean;
  /** The stage has been saved (completeStage succeeded). */
  isSaved: boolean;
  /** The next stage's handoff pop-up is open. */
  isHandoffOpen: boolean;
};

export type PostCallEvent =
  | { type: "callEnded"; endReason: CallSessionEndReason }
  | { type: "saved" }
  | { type: "crisisNoticeDismissed" }
  | { type: "submitted" }
  | { type: "handoffDismissed" };

/** Before any call has ended: no notice, nothing saved, no pop-up. */
export const INITIAL_POST_CALL_STATE: PostCallState = {
  isCrisisNoticeOpen: false,
  isSaved: false,
  isHandoffOpen: false,
};

/**
 * The post-call state after an event.
 * @param state - The current state
 * @param event - callEnded (with its endReason), saved, crisisNoticeDismissed, submitted (the Submit button) or handoffDismissed
 * @returns The next state
 */
export function reducePostCall(state: PostCallState, event: PostCallEvent): PostCallState {
  switch (event.type) {
    case "callEnded":
      return { isCrisisNoticeOpen: event.endReason === "crisis", isSaved: false, isHandoffOpen: false };
    case "saved":
      // Never over the crisis notice: then the pop-up waits for the student to dismiss it.
      return { ...state, isSaved: true, isHandoffOpen: state.isHandoffOpen || !state.isCrisisNoticeOpen };
    case "crisisNoticeDismissed":
      // Already saved: the pop-up opens now; otherwise when the save finishes.
      return { ...state, isCrisisNoticeOpen: false, isHandoffOpen: state.isHandoffOpen || state.isSaved };
    case "submitted":
      return { ...state, isHandoffOpen: true };
    case "handoffDismissed":
      return { ...state, isHandoffOpen: false };
  }
}
