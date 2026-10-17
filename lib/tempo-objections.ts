/**
 * tempo-objections.ts
 * Types, copy, and helpers for Tempo Stage 4 Objection Handling (default class only).
 */

export type ObjectionHandlingPhase = "lobby" | "connecting" | "active" | "summary";

export type ObjectionTranscriptEntry = {
  role: "student" | "drKim";
  content: string;
  timestamp: string;
};

export interface ObjectionSummaryForm {
  objectionsRaised: string;
  rootConcerns: string;
  howYouResponded: string;
  priceAndDiscounting: string;
  nextStep: string;
}

export interface ObjectionTracker {
  price: boolean;
  priceHandled: boolean;
  adoption: boolean;
  adoptionHandled: boolean;
  statusQuo: boolean;
  statusQuoHandled: boolean;
}

export const EMPTY_SUMMARY: ObjectionSummaryForm = {
  objectionsRaised: "",
  rootConcerns: "",
  howYouResponded: "",
  priceAndDiscounting: "",
  nextStep: "",
};

export const EMPTY_TRACKER: ObjectionTracker = {
  price: false,
  priceHandled: false,
  adoption: false,
  adoptionHandled: false,
  statusQuo: false,
  statusQuoHandled: false,
};

export const OBJECTION_SUMMARY_FIELDS: {
  id: keyof ObjectionSummaryForm;
  label: string;
  helper: string;
  placeholder: string;
}[] = [
  {
    id: "objectionsRaised",
    label: "1. Objections Raised",
    helper: "List the specific points where Dr. Kim expressed hesitation or resistance.",
    placeholder: "Type your answer",
  },
  {
    id: "rootConcerns",
    label: "2. Root Concerns",
    helper: "What was the underlying fear or pain point behind their objections?",
    placeholder: "Type your answer",
  },
  {
    id: "howYouResponded",
    label: "3. How You Responded",
    helper: "Summarize your strategy for addressing these concerns. Did you acknowledge first?",
    placeholder: "Type your answer",
  },
  {
    id: "priceAndDiscounting",
    label: "4. Price and Discounting",
    helper: "Record any specific mentions of pricing. Did you hold firm or concede? What did you trade for it?",
    placeholder: "Type your answer",
  },
  {
    id: "nextStep",
    label: "5. Next Step",
    helper: "What is the definitive action item agreed upon for the Negotiation phase?",
    placeholder: "Type your answer",
  },
];

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
 * Formats seconds as MM:SS for call timers.
 */
export function formatObjectionTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

/**
 * Returns true when every debrief field has substantive content.
 */
export function canSubmitObjectionSummary(form: ObjectionSummaryForm): boolean {
  return Object.values(form).every((val) => val.trim().length > 10);
}

/**
 * Parses voice session transcript lines into structured entries.
 */
export function parseObjectionTranscript(
  raw: string,
  callSeconds: number
): ObjectionTranscriptEntry[] {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  return lines.map((line, index) => {
    const isStudent = line.startsWith("Student:");
    const content = line.replace(/^(Student|Persona):\s*/, "").trim();
    const approxSeconds = Math.min(
      callSeconds,
      Math.floor(((index + 1) / lines.length) * Math.max(callSeconds, 1))
    );
    return {
      role: isStudent ? "student" : "drKim",
      content,
      timestamp: formatObjectionTime(approxSeconds),
    };
  });
}

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
