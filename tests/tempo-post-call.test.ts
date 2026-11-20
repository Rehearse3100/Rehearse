/**
 * tempo-post-call.test.ts
 * lib/tempo-post-call.ts, the order of the Discovery / Objection Handling post-call screen:
 * after a crisis ending the 988 notice comes first, and the next stage's handoff pop-up
 * opens only when the student dismisses it (at once if saved, else when the save
 * finishes) or presses Submit; after any other ending the pop-up opens once the stage is
 * saved, as before. Pure; no network.
 */

import { describe, expect, it } from "vitest";
import type { CallSessionEndReason } from "@/lib/call-config";
import {
  INITIAL_POST_CALL_STATE,
  reducePostCall,
  type PostCallEvent,
  type PostCallState,
} from "@/lib/tempo-post-call";

/** The state after these events, from the start. */
const after = (...events: PostCallEvent[]): PostCallState => events.reduce(reducePostCall, INITIAL_POST_CALL_STATE);

const ended = (endReason: CallSessionEndReason): PostCallEvent => ({ type: "callEnded", endReason });

describe("the post-call screen after a crisis ending", () => {
  it("the notice shows and the save does not open the pop-up over it", () => {
    expect(after(ended("crisis"))).toEqual({ isCrisisNoticeOpen: true, isSaved: false, isHandoffOpen: false });
    expect(after(ended("crisis"), { type: "saved" })).toEqual({ isCrisisNoticeOpen: true, isSaved: true, isHandoffOpen: false });
  });

  it("dismissing the notice after the save opens the pop-up at once", () => {
    expect(after(ended("crisis"), { type: "saved" }, { type: "crisisNoticeDismissed" })).toEqual({
      isCrisisNoticeOpen: false,
      isSaved: true,
      isHandoffOpen: true,
    });
  });

  it("dismissing the notice before the save: the pop-up opens when the save finishes", () => {
    const dismissed = after(ended("crisis"), { type: "crisisNoticeDismissed" });
    expect(dismissed).toEqual({ isCrisisNoticeOpen: false, isSaved: false, isHandoffOpen: false });
    expect(reducePostCall(dismissed, { type: "saved" }).isHandoffOpen).toBe(true);
  });

  it("Submit opens the pop-up (the student continued); closing it leaves the screen as it was", () => {
    const submitted = after(ended("crisis"), { type: "saved" }, { type: "submitted" });
    expect(submitted.isHandoffOpen).toBe(true);
    expect(reducePostCall(submitted, { type: "handoffDismissed" })).toEqual({
      isCrisisNoticeOpen: true,
      isSaved: true,
      isHandoffOpen: false,
    });
  });
});

describe("the post-call screen after any other ending: as before", () => {
  it.each<CallSessionEndReason>(["student", "goodbye", "time_up", "rude", "break_character", "silence", "backstop"])(
    "%s: no notice; the pop-up opens once the stage is saved",
    (endReason) => {
      expect(after(ended(endReason))).toEqual({ isCrisisNoticeOpen: false, isSaved: false, isHandoffOpen: false });
      expect(after(ended(endReason), { type: "saved" })).toEqual({ isCrisisNoticeOpen: false, isSaved: true, isHandoffOpen: true });
    }
  );

  it("closing the pop-up closes it; Submit opens it again", () => {
    const closed = after(ended("goodbye"), { type: "saved" }, { type: "handoffDismissed" });
    expect(closed.isHandoffOpen).toBe(false);
    expect(reducePostCall(closed, { type: "submitted" }).isHandoffOpen).toBe(true);
  });
});
