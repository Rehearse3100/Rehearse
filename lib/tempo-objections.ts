/**
 * tempo-objections.ts
 * Types, copy, and helpers for Tempo Stage 4 Objection Handling (default class only).
 */

import type { CallTranscriptEntry } from "@/lib/tempo-call-transcript";

export type ObjectionHandlingPhase = "lobby" | "connecting" | "active" | "summary";

/** An Objection Handling call transcript line (lib/tempo-call-transcript.ts); Dr. Kim's lines are "drKim". */
export type ObjectionTranscriptEntry = CallTranscriptEntry<"drKim">;

export interface ObjectionTracker {
  price: boolean;
  priceHandled: boolean;
  adoption: boolean;
  adoptionHandled: boolean;
  statusQuo: boolean;
  statusQuoHandled: boolean;
}

export const EMPTY_TRACKER: ObjectionTracker = {
  price: false,
  priceHandled: false,
  adoption: false,
  adoptionHandled: false,
  statusQuo: false,
  statusQuoHandled: false,
};

export const OBJECTION_TIPS = [
  "Acknowledge objections before answering.",
  "Pivot from cost to return on effort — not discounts.",
  "Dr. Kim leads with price, then adoption, then status quo.",
  "Hold firm on price; trade value, not margin.",
] as const;

/** The Objection Handling call's persona, as the Reference Library labels the transcript. */
export const OBJECTION_PERSONA = { name: "Dr. Saul Kim", role: "Founder & Owner" } as const;

/** The manager note on the Objection Handling pre-call lobby, one paragraph per entry. */
export const OBJECTION_MANAGER_NOTE = [
  "Heads up: this is your follow-up with Dr. Saul Kim, who owns Summit Dental Group. Dr. Kim has read the proposal and will push back on price, on the extra work for the staff, and on timing. Dana will be on the call too, but expect Dr. Kim to do most of the talking.",
  "Let Dr. Kim get the whole objection out before you jump in. Ask what's really behind it, then tie your answer back to what you heard from Dana in discovery. And don't offer a discount just to make the conversation less awkward.",
] as const;

const PRICE_RAISED = /price|cost|worth it|adds up|budget|expensive|pay for itself|monthly/i;
const ADOPTION_RAISED =
  /adopt|front desk|staff|homework|rollout|training|onboard|new software|twenty years/i;
const STATUS_QUO_RAISED =
  /managed fine|our way|status quo|doing it our way|growing to eight|eight locations doing/i;

const PRICE_HANDLED =
  /roi|no-show|recovery|pay for|return|revenue|138|savings|worth|per location/i;
const ADOPTION_HANDLED =
  /train|onboard|days|weeks|support|ease|implementation|live in|hand-hold/i;
const STATUS_QUO_HANDLED =
  /inaction|leak|turnover|chaos|hidden cost|losing|without|current approach|manual/i;

/**
 * Updates objection tracker chips from live transcript entries.
 */
export function deriveObjectionTracker(entries: ObjectionTranscriptEntry[]): ObjectionTracker {
  const tracker: ObjectionTracker = { ...EMPTY_TRACKER };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.role === "drKim") {
      if (PRICE_RAISED.test(entry.content)) {
        tracker.price = true;
      }
      if (ADOPTION_RAISED.test(entry.content)) {
        tracker.adoption = true;
      }
      if (STATUS_QUO_RAISED.test(entry.content)) {
        tracker.statusQuo = true;
      }
    }

    if (entry.role === "student" && entry.content.trim().length >= 20) {
      if (tracker.price && !tracker.priceHandled && PRICE_HANDLED.test(entry.content)) {
        tracker.priceHandled = true;
      }
      if (tracker.adoption && !tracker.adoptionHandled && ADOPTION_HANDLED.test(entry.content)) {
        tracker.adoptionHandled = true;
      }
      if (
        tracker.statusQuo &&
        !tracker.statusQuoHandled &&
        STATUS_QUO_HANDLED.test(entry.content)
      ) {
        tracker.statusQuoHandled = true;
      }

      // Substantive student reply after an objection was raised counts as handled.
      const priorKim = entries.slice(0, i).reverse().find((e) => e.role === "drKim");
      if (priorKim) {
        if (tracker.price && !tracker.priceHandled && PRICE_RAISED.test(priorKim.content)) {
          tracker.priceHandled = true;
        }
        if (tracker.adoption && !tracker.adoptionHandled && ADOPTION_RAISED.test(priorKim.content)) {
          tracker.adoptionHandled = true;
        }
        if (
          tracker.statusQuo &&
          !tracker.statusQuoHandled &&
          STATUS_QUO_RAISED.test(priorKim.content)
        ) {
          tracker.statusQuoHandled = true;
        }
      }
    }
  }

  return tracker;
}
