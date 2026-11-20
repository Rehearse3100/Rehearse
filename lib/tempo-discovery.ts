/**
 * tempo-discovery.ts
 * Types, copy, and helpers for Tempo Stage 2 Discovery (default class only).
 */

import type { CallTranscriptEntry } from "@/lib/tempo-call-transcript";

export type DiscoveryPhase = "prep" | "lobby" | "connecting" | "active" | "summary";

/** A Discovery call transcript line (lib/tempo-call-transcript.ts); Dana's lines are "dana". */
export type DiscoveryTranscriptEntry = CallTranscriptEntry<"dana">;

/** Pre-call Open / Probe / Confirm planning form (required before lobby). */
export type DiscoveryPreCallPrep = {
  openQuestions: [string, string, string];
  anticipatedProbe: string;
  anticipatedConfirm: string;
};

const EMPTY_DISCOVERY_PRE_CALL_PREP: DiscoveryPreCallPrep = {
  openQuestions: ["", "", ""],
  anticipatedProbe: "",
  anticipatedConfirm: "",
};

export const DISCOVERY_TIPS = [
  "Ask open-ended questions: what, how, walk me through",
  "Let her finish before responding",
  "Don't mention pricing in this stage",
  "Get her to put numbers on the pain",
] as const;

/** The Discovery call's persona, as the Reference Library labels her transcript. */
export const DISCOVERY_PERSONA = { name: "Dana Reyes", role: "Director of Operations" } as const;

/** The manager note on the Discovery pre-call lobby, one paragraph per entry. */
export const DISCOVERY_MANAGER_NOTE = [
  "Quick one before your call with Dana Reyes, Director of Operations at Summit Dental Group. This is your first real conversation with them, so don't sell anything yet. I want to know how they book appointments and handle the phones today, and what it costs them when that goes wrong.",
  "Ask open questions, then let Dana talk. When something sounds painful, dig in and get a number on it. Save the product and pricing for later.",
] as const;

const PREP_STORAGE_PREFIX = "tempo-discovery-prep-v2-";

type StoredDiscoveryPrep = {
  form: DiscoveryPreCallPrep;
  confirmed: boolean;
};

/**
 * True when a saved field looks like pasted page/markup rather than student plan text.
 */
function looksLikeHtmlMarkup(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 40) {
    return false;
  }
  if (/<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return true;
  }
  if (/<(script|style|head|body|meta|link)\b/i.test(trimmed)) {
    return true;
  }
  const tagMatches = trimmed.match(/<\/?[a-zA-Z][^>]*>/g);
  return (tagMatches?.length ?? 0) >= 5;
}

/**
 * Returns student text, or empty string when the value is corrupted HTML markup.
 */
function sanitizeFieldText(value: string): string {
  return looksLikeHtmlMarkup(value) ? "" : value;
}

/**
 * True when prep has enough content to enable Begin Discovery Call.
 * Requires ≥1 open question, plus non-empty probe and confirm fields.
 * testBypass is a server-passed boolean — this file never reads process.env.
 */
export function canBeginDiscoveryCall(
  form: DiscoveryPreCallPrep,
  testBypass = false
): boolean {
  if (testBypass) {
    return true;
  }
  const hasOpen = form.openQuestions.some((q) => q.trim().length > 0);
  return (
    hasOpen &&
    form.anticipatedProbe.trim().length > 0 &&
    form.anticipatedConfirm.trim().length > 0
  );
}

/**
 * Normalizes unknown saved prep into the DiscoveryPreCallPrep shape.
 * Scrubs fields that look like accidentally pasted HTML documents.
 */
function normalizeDiscoveryPreCallPrep(raw: unknown): DiscoveryPreCallPrep {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_DISCOVERY_PRE_CALL_PREP, openQuestions: ["", "", ""] };
  }
  const obj = raw as Record<string, unknown>;
  const questionsRaw = Array.isArray(obj.openQuestions) ? obj.openQuestions : [];
  const openQuestions: [string, string, string] = [
    sanitizeFieldText(typeof questionsRaw[0] === "string" ? questionsRaw[0] : ""),
    sanitizeFieldText(typeof questionsRaw[1] === "string" ? questionsRaw[1] : ""),
    sanitizeFieldText(typeof questionsRaw[2] === "string" ? questionsRaw[2] : ""),
  ];
  return {
    openQuestions,
    anticipatedProbe: sanitizeFieldText(
      typeof obj.anticipatedProbe === "string" ? obj.anticipatedProbe : ""
    ),
    anticipatedConfirm: sanitizeFieldText(
      typeof obj.anticipatedConfirm === "string" ? obj.anticipatedConfirm : ""
    ),
  };
}

/**
 * Saves prep draft (+ whether the student confirmed / left the prep step) to localStorage.
 */
export function saveDiscoveryPrepToStorage(
  attemptId: string,
  form: DiscoveryPreCallPrep,
  confirmed: boolean
): void {
  try {
    const payload: StoredDiscoveryPrep = {
      form: normalizeDiscoveryPreCallPrep(form),
      confirmed,
    };
    localStorage.setItem(`${PREP_STORAGE_PREFIX}${attemptId}`, JSON.stringify(payload));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Loads prep draft from localStorage, or null when missing/invalid.
 * HTML-corrupted drafts are scrubbed and rewritten clean.
 */
export function loadDiscoveryPrepFromStorage(attemptId: string): StoredDiscoveryPrep | null {
  try {
    const raw = localStorage.getItem(`${PREP_STORAGE_PREFIX}${attemptId}`);
    if (!raw) {
      // Also clear any pre-v2 corrupted keys for this attempt.
      try {
        localStorage.removeItem(`tempo-discovery-prep-${attemptId}`);
      } catch {
        /* ignore */
      }
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredDiscoveryPrep>;
    const form = normalizeDiscoveryPreCallPrep(parsed.form);
    const confirmed = parsed.confirmed === true;
    localStorage.setItem(
      `${PREP_STORAGE_PREFIX}${attemptId}`,
      JSON.stringify({ form, confirmed } satisfies StoredDiscoveryPrep)
    );
    try {
      localStorage.removeItem(`tempo-discovery-prep-${attemptId}`);
    } catch {
      /* ignore */
    }
    return { form, confirmed };
  } catch {
    return null;
  }
}

/**
 * Clears Discovery pre-call prep from localStorage (e.g. on simulation restart).
 */
export function clearDiscoveryPrepFromStorage(attemptId: string): void {
  try {
    localStorage.removeItem(`${PREP_STORAGE_PREFIX}${attemptId}`);
    localStorage.removeItem(`tempo-discovery-prep-${attemptId}`);
  } catch {
    /* ignore */
  }
}

/**
 * Clears every Discovery prep draft key (used by Test → Discovery when attempt id is unknown).
 */
export function clearAllDiscoveryPrepFromStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith(PREP_STORAGE_PREFIX) || key.startsWith("tempo-discovery-prep-"))
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Extracts preCallPrep from a Discovery stage_scores transcript JSON blob.
 */
export function parseDiscoveryPreCallPrepFromTranscript(
  transcript: string | null | undefined
): DiscoveryPreCallPrep | null {
  if (!transcript?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(transcript) as { preCallPrep?: unknown };
    if (!parsed.preCallPrep) {
      return null;
    }
    return normalizeDiscoveryPreCallPrep(parsed.preCallPrep);
  } catch {
    return null;
  }
}
