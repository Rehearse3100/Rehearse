/**
 * tempo-presentation.ts
 * Types, copy, and helpers for Tempo Stage 3 Presentation (default class only).
 * Form follows ValueSelling fields: Business Issue / Problem / Solution /
 * Value / Power / Plan. Display titles may change; persisted keys stay stable.
 */

import type { DiscoverySummaryForm } from "@/lib/tempo-discovery";

export type PresentationForm = {
  businessCase: string;
  underlyingPainPoints: string;
  solution: string;
  proofPoint: string;
  powerStakeholder: string;
  nextStep: string;
};

export const EMPTY_PRESENTATION_FORM: PresentationForm = {
  businessCase: "",
  underlyingPainPoints: "",
  solution: "",
  proofPoint: "",
  powerStakeholder: "",
  nextStep: "",
};

/** Static ROI reference shown in the Value section (not student-editable). */
export const PRESENTATION_PAYOFF_REFERENCE =
  "Reference: 6,400 appts × 18% no-shows × $120 = $138,240/month lost";

export type PresentationStageData = {
  presentation?: PresentationForm;
};

export const PRESENTATION_SECTIONS = [
  { number: 1, title: "Business Issue", field: "businessCase" as const },
  { number: 2, title: "Problem", field: "underlyingPainPoints" as const },
  { number: 3, title: "Solution", field: "solution" as const },
  { number: 4, title: "Value", field: "proofPoint" as const },
  { number: 5, title: "Power", field: "powerStakeholder" as const },
  { number: 6, title: "Plan", field: "nextStep" as const },
] as const;

export const TEMPO_REFERENCE_SECTIONS = [
  {
    label: "Proof Points",
    content: [
      "~35% drop in no-shows within 90 days",
      "~6 hours/week saved per front desk location",
      "Front Range Vet Partners: 19% → 11% no-shows",
    ],
  },
  {
    label: "Pricing Model",
    content: [
      "Starter: $99/location/month",
      "Pro: $179/location/month",
      "Annual: ~15% off",
      "Onboarding: $500/location",
    ],
  },
  {
    label: "Competitor Matrix",
    content: [
      "SlotEasy: $59, reminders only",
      "Status quo: hides true cost",
      "BookSuite: too complex",
    ],
  },
] as const;

const STORAGE_PREFIX = "tempo-presentation-v2-";
const MIN_FIELD_LENGTH = 6;

/**
 * True when a saved field looks like pasted page/markup rather than student pitch text.
 * Used to scrub drafts corrupted by accidental HTML paste (autosave persists each keystroke).
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
 * True when any string value in a saved draft looks like pasted HTML markup.
 */
export function presentationDraftHasHtmlCorruption(raw: Record<string, unknown>): boolean {
  return Object.values(raw).some(
    (value) => typeof value === "string" && looksLikeHtmlMarkup(value)
  );
}

/**
 * Returns true when a trimmed string meets the minimum length.
 */
function minFilled(value: string, minLen = MIN_FIELD_LENGTH): boolean {
  return value.trim().length >= minLen;
}

/**
 * Returns true when section N has required content filled.
 */
export function isPresentationSectionComplete(
  sectionNumber: number,
  form: PresentationForm
): boolean {
  switch (sectionNumber) {
    case 1:
      return minFilled(form.businessCase);
    case 2:
      return minFilled(form.underlyingPainPoints);
    case 3:
      return minFilled(form.solution);
    case 4:
      return minFilled(form.proofPoint);
    case 5:
      return minFilled(form.powerStakeholder);
    case 6:
      return minFilled(form.nextStep);
    default:
      return false;
  }
}

/**
 * Counts how many of the six main sections are complete.
 */
export function countCompletedPresentationSections(form: PresentationForm): number {
  return PRESENTATION_SECTIONS.filter((s) =>
    isPresentationSectionComplete(s.number, form)
  ).length;
}

/**
 * True when all six presentation fields are filled.
 */
export function canSubmitPresentation(form: PresentationForm): boolean {
  return countCompletedPresentationSections(form) === 6;
}

/**
 * Maps a legacy or current saved draft onto the PresentationForm shape.
 */
export function normalizePresentationForm(raw: Record<string, unknown>): PresentationForm {
  const str = (key: string): string =>
    typeof raw[key] === "string" ? (raw[key] as string) : "";

  // Prefer new keys; fall back to pre-restructure field names when loading old drafts.
  const solutionFromLegacy =
    str("solution") ||
    [str("valueDriverNoShows"), str("valueDriverFrontDesk"), str("valueDriverAfterHours"), str("valueDriverRepeat")]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");

  return {
    businessCase: sanitizeFieldText(str("businessCase") || str("businessIssue")),
    underlyingPainPoints: sanitizeFieldText(str("underlyingPainPoints")),
    solution: sanitizeFieldText(solutionFromLegacy),
    proofPoint: sanitizeFieldText(str("proofPoint")),
    powerStakeholder: sanitizeFieldText(str("powerStakeholder") || str("bothStakeholders")),
    nextStep: sanitizeFieldText(str("nextStep")),
  };
}

/**
 * Parses Stage 3 presentation form from a stage_scores transcript JSON blob.
 */
export function parsePresentationFormFromTranscript(
  transcript: string | null | undefined
): PresentationForm | null {
  if (!transcript?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(transcript) as { form?: Record<string, unknown> };
    if (!parsed.form || typeof parsed.form !== "object") {
      return null;
    }
    return normalizePresentationForm(parsed.form);
  } catch {
    return null;
  }
}

export function parseDiscoverySummaryFromTranscript(
  transcript: string | null | undefined
): Partial<DiscoverySummaryForm> {
  if (!transcript?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(transcript) as { postCallSummary?: Partial<DiscoverySummaryForm> };
    return parsed.postCallSummary ?? {};
  } catch {
    return {};
  }
}

/**
 * Saves presentation draft to localStorage.
 */
export function savePresentationToStorage(attemptId: string, form: PresentationForm): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${attemptId}`, JSON.stringify(form));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Loads presentation draft from localStorage.
 */
export function loadPresentationFromStorage(attemptId: string): PresentationForm | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${attemptId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizePresentationForm(parsed);
  } catch {
    return null;
  }
}

/**
 * Clears presentation draft from localStorage (e.g. on simulation restart).
 */
export function clearPresentationFromStorage(attemptId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${attemptId}`);
  } catch {
    /* ignore */
  }
}
