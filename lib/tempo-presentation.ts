/**
 * tempo-presentation.ts
 * Types, copy, and helpers for Tempo Stage 3 Presentation (default class only).
 * Form follows ValueSelling fields: Business Issue / Problem / Solution /
 * Value / Power / Plan. Display titles may change; persisted keys stay stable.
 */

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

// ── Slide-deck builder copy (display only; each slide binds one field above) ───

export type PresentationSlide = {
  number: number;
  field: keyof PresentationForm;
  /** The ValueSelling label, shown as the slide's eyebrow. */
  label: string;
  title: string;
  /** One line of direction above the slide. */
  direction: string;
  /** A second, smaller direction line (slide 4: the ROI reference). */
  directionNote?: string;
};

/** Title and direction per section number. */
const SLIDE_COPY: Record<number, Pick<PresentationSlide, "title" | "direction" | "directionNote">> = {
  1: {
    title: "What we heard",
    direction: "Recap the business issue in their words. What did they say matters most? 2–3 short lines.",
  },
  2: {
    title: "The cost of the problem",
    direction: "Show the problem behind it and what it costs them today. 2–3 short lines.",
  },
  3: {
    title: "How Tempo fixes it",
    direction: "Connect Tempo to the problems they named. Only what they need. 2–3 short lines.",
  },
  4: {
    title: "The impact",
    direction: "Put a number on what fixing this is worth to them.",
    directionNote: PRESENTATION_PAYOFF_REFERENCE,
  },
  5: {
    title: "Who's involved",
    direction: "Who decides, who signs off, and what each of them cares about. 2–3 short lines.",
  },
  6: {
    title: "Next steps",
    direction: "Propose the next step with an owner and a date. 1–2 short lines.",
  },
};

/** The six slides, in order: one per section, bound to that section's field. */
export const PRESENTATION_SLIDES: readonly PresentationSlide[] = PRESENTATION_SECTIONS.map((section) => ({
  number: section.number,
  field: section.field,
  label: section.title,
  ...SLIDE_COPY[section.number],
}));

const STORAGE_PREFIX = "tempo-presentation-v2-";
export const MIN_FIELD_LENGTH = 6;

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
 * testBypass is a server-passed boolean — this file never reads process.env.
 */
export function canSubmitPresentation(
  form: PresentationForm,
  testBypass = false
): boolean {
  if (testBypass) {
    return true;
  }
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
