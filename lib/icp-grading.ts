/**
 * icp-grading.ts
 * Simulation-neutral grading for a student's Ideal Customer Profile (ICP): the
 * rubric and result types, the grading prompt and its JSON schema (step A), the
 * evidence check, the location range scored in code, scoring and bands, the
 * manager-note prompt (step B), the note checks and the code-built fallback note,
 * and the saved record (attempts.stage_data.icp) with a parser that also reads the
 * old record shape. Each simulation supplies its rubric and note copy as
 * server-only config (a lib/<simulation>-icp-criteria.ts file used by
 * app/api/student/icp-check). Nothing here names a product, customer, place or
 * company. The student only ever sees IcpNoteView: the note and its state, never
 * the score, band or criteria.
 */

// ── Model settings ───

export const ICP_GRADING_MODEL = "gpt-4o";
/** Step A grades deterministically. */
export const ICP_GRADE_TEMPERATURE = 0;
/** Step B writes the note with a little variety. */
export const ICP_NOTE_TEMPERATURE = 0.4;
export const ICP_NOTE_MAX_TOKENS = 400;

// ── Rubric ───

export type IcpVerdict = "met" | "partial" | "missing";

export const ICP_VERDICTS: readonly IcpVerdict[] = ["met", "partial", "missing"];

export type IcpBand = "strong" | "developing" | "needs_work";

/** A criterion the model grades from the student's text. */
export type IcpAiCriterion = {
  kind: "ai";
  id: string;
  label: string;
  points: number;
  met: string;
  partial: string;
  missing: string;
};

/** The location-range criterion: scored in code only, never shown to a model. */
export type IcpSizeCriterion = {
  kind: "size";
  id: string;
  label: string;
  points: number;
  /** The real range; partial needs the student's range to overlap it. */
  realMin: number;
  realMax: number;
  /** Met: the student's min and max each fall inside these bounds (inclusive). */
  metMin: readonly [number, number];
  metMax: readonly [number, number];
  /** Gap sentences for the note; they must not reveal the real range. */
  gaps: { partial: string; missing: string };
};

export type IcpRubricCriterion = IcpAiCriterion | IcpSizeCriterion;

export type IcpRubric = {
  version: string;
  /** One line on the product and who it serves, for the grader. */
  productContext: string;
  /** In form order; the points add up to 100. */
  criteria: readonly IcpRubricCriterion[];
  /** Lowest score in each band (below developing is needs_work). */
  bands: { strong: number; developing: number };
};

/** One labelled student field, as shown to the models. */
export type IcpField = { label: string; value: string };

/** One criterion's saved result. */
export type IcpCriterionResult = {
  id: string;
  verdict: IcpVerdict;
  evidence: string;
  gap: string;
  points: number;
};

/** The model's verdict for one criterion, before the evidence check. */
export type IcpModelVerdict = { verdict: IcpVerdict; evidence: string; gap: string };

// ── Fields ───

/** Splits "Label: value" lines (e.g. formatIcpTextForFeedback output) into labelled fields. */
export function splitLabelledText(text: string): IcpField[] {
  return text
    .split("\n")
    .map((line) => {
      const colon = line.indexOf(":");
      return colon === -1
        ? { label: "", value: line.trim() }
        : { label: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    })
    .filter((field) => field.value.length > 0);
}

const renderFields = (fields: readonly IcpField[]): string =>
  fields.map((field) => (field.label ? `${field.label}: ${field.value}` : field.value)).join("\n");

const aiCriteriaOf = (rubric: IcpRubric): IcpAiCriterion[] =>
  rubric.criteria.filter((criterion): criterion is IcpAiCriterion => criterion.kind === "ai");

// ── Step A: grading prompt and schema ───

/**
 * The grading messages: the rubric (model-graded criteria only; never the
 * code-scored range) and the student's fields. The model returns a verdict, an
 * exact quote and a gap per criterion, never a score.
 */
export function buildGradingMessages(
  rubric: IcpRubric,
  fields: readonly IcpField[]
): { system: string; user: string } {
  const criteria = aiCriteriaOf(rubric)
    .map(
      (criterion) =>
        `${criterion.id} (${criterion.label})\n  met: ${criterion.met}\n  partial: ${criterion.partial}\n  missing: ${criterion.missing}`
    )
    .join("\n\n");
  const system = [
    "You grade a sales student's Ideal Customer Profile (ICP) against a fixed rubric.",
    rubric.productContext,
    "",
    "For each criterion below, decide whether the student's ICP meets it, partly meets it, or misses it, using only what the student actually wrote. Do not infer intent they did not state.",
    "Return for each criterion:",
    '- verdict: "met", "partial" or "missing".',
    '- evidence: a short exact quote copied character for character from the student\'s ICP that supports the verdict, or "" if nothing supports it. Never paraphrase.',
    '- gap: one short sentence on what is missing or vague, written to the student ("" when met).',
    "Do not output a score, points or a grade.",
    "",
    "Criteria:",
    criteria,
  ].join("\n");
  return { system, user: `The student's ICP:\n\n${renderFields(fields)}` };
}

/** Strict JSON schema for the grading reply: one object per model-graded criterion. */
export function buildGradingSchema(rubric: IcpRubric): {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
} {
  const ids = aiCriteriaOf(rubric).map((criterion) => criterion.id);
  const verdictSchema = {
    type: "object",
    properties: {
      verdict: { type: "string", enum: [...ICP_VERDICTS] },
      evidence: { type: "string" },
      gap: { type: "string" },
    },
    required: ["verdict", "evidence", "gap"],
    additionalProperties: false,
  };
  return {
    name: "icp_grade",
    strict: true,
    schema: {
      type: "object",
      properties: Object.fromEntries(ids.map((id) => [id, verdictSchema])),
      required: ids,
      additionalProperties: false,
    },
  };
}

/** Reads the grading reply; null unless every model-graded criterion has a valid verdict. */
export function parseGradingReply(raw: string | null | undefined, rubric: IcpRubric): Record<string, IcpModelVerdict> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const out: Record<string, IcpModelVerdict> = {};
  for (const criterion of aiCriteriaOf(rubric)) {
    const entry = (parsed as Record<string, unknown>)[criterion.id];
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const { verdict, evidence, gap } = entry as Record<string, unknown>;
    if (!ICP_VERDICTS.includes(verdict as IcpVerdict)) {
      return null;
    }
    out[criterion.id] = {
      verdict: verdict as IcpVerdict,
      evidence: typeof evidence === "string" ? evidence.trim() : "",
      gap: typeof gap === "string" ? gap.trim() : "",
    };
  }
  return out;
}

// ── Evidence check ───

const normalizeForMatch = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Surrounding quote marks the model may add around a quote. */
const QUOTE_EDGES = /^["'“”‘’]+|["'“”‘’]+$/g;

/** True when the quote appears in the student's text, ignoring case and whitespace. */
export function quoteAppearsIn(quote: string, studentText: string): boolean {
  const needle = normalizeForMatch(quote.replace(QUOTE_EDGES, ""));
  return needle.length > 0 && normalizeForMatch(studentText).includes(needle);
}

/** A met or partial verdict whose quote isn't in the student's text drops one level (met → partial → missing). */
export function applyEvidenceCheck(result: IcpModelVerdict, studentText: string): IcpModelVerdict {
  if (result.verdict === "missing" || quoteAppearsIn(result.evidence, studentText)) {
    return result;
  }
  return { ...result, verdict: result.verdict === "met" ? "partial" : "missing" };
}

// ── Size (code only) ───

/** The location range verdict: met inside the met bounds, partial when it overlaps the real range, else missing. */
export function scoreSizeRange(min: number | null, max: number | null, size: IcpSizeCriterion): IcpVerdict {
  if (min === null || max === null || max < min) {
    return "missing";
  }
  if (min >= size.metMin[0] && min <= size.metMin[1] && max >= size.metMax[0] && max <= size.metMax[1]) {
    return "met";
  }
  return min <= size.realMax && max >= size.realMin ? "partial" : "missing";
}

// ── Scoring ───

/** Met = full points, partial = half, missing = 0. */
export function pointsFor(verdict: IcpVerdict, points: number): number {
  return verdict === "met" ? points : verdict === "partial" ? points / 2 : 0;
}

export function bandFor(score: number, bands: IcpRubric["bands"]): IcpBand {
  return score >= bands.strong ? "strong" : score >= bands.developing ? "developing" : "needs_work";
}

/**
 * Every criterion's result in rubric order: the model's verdicts after the
 * evidence check, and the range scored in code. Score and band come from these
 * results only; the model never gives a score.
 */
export function gradeIcp(input: {
  rubric: IcpRubric;
  verdicts: Record<string, IcpModelVerdict>;
  studentText: string;
  sizeMin: number | null;
  sizeMax: number | null;
}): { criteria: IcpCriterionResult[]; score: number; band: IcpBand } {
  const criteria = input.rubric.criteria.map((criterion): IcpCriterionResult => {
    if (criterion.kind === "size") {
      const verdict = scoreSizeRange(input.sizeMin, input.sizeMax, criterion);
      return {
        id: criterion.id,
        verdict,
        evidence: input.sizeMin !== null && input.sizeMax !== null ? `${input.sizeMin}–${input.sizeMax} locations` : "",
        gap: verdict === "met" ? "" : criterion.gaps[verdict],
        points: pointsFor(verdict, criterion.points),
      };
    }
    const checked = applyEvidenceCheck(
      input.verdicts[criterion.id] ?? { verdict: "missing", evidence: "", gap: "" },
      input.studentText
    );
    return {
      id: criterion.id,
      verdict: checked.verdict,
      evidence: checked.verdict === "missing" ? "" : checked.evidence.replace(QUOTE_EDGES, "").trim(),
      gap: checked.verdict === "met" ? "" : checked.gap,
      points: pointsFor(checked.verdict, criterion.points),
    };
  });
  const score = criteria.reduce((sum, criterion) => sum + criterion.points, 0);
  return { criteria, score, band: bandFor(score, input.rubric.bands) };
}

// ── Step B: manager note ───

/** Per-simulation wording for the manager note and its fallbacks. */
export type IcpNoteCopy = {
  productName: string;
  /** Who is writing, e.g. "the rep's sales manager". */
  managerVoice: string;
  minWords: number;
  maxWords: number;
  /** Saved when grading fails: encouraging, no verdicts. */
  ungradedNote: string;
  fallback: {
    /** Before the quoted strength, e.g. "One thing you got right:". */
    strengthLead: string;
    /** After the quoted strength. */
    strengthFollow: string;
    /** When nothing was met. */
    noStrength: string;
    firstGapLead: string;
    secondGapLead: string;
    /** Asked after the gaps. */
    gapQuestion: string;
    /** The line to carry into research. */
    closing: string;
  };
};

/**
 * The note messages. The model sees ONLY the student's fields and each
 * criterion's verdict, evidence and gap: never the rubric's answer lists, the
 * real range, a score or a band.
 */
export function buildNoteMessages(input: {
  copy: IcpNoteCopy;
  rubric: IcpRubric;
  fields: readonly IcpField[];
  criteria: readonly IcpCriterionResult[];
}): { system: string; user: string } {
  const { copy } = input;
  const system = [
    `You are ${copy.managerVoice}. Write a short note to a sales rep on your team about the Ideal Customer Profile (ICP) they just wrote for ${copy.productName}.`,
    `Write ${copy.minWords}–${copy.maxWords} words in second person ("you"), as plain prose in one or two short paragraphs, in a direct, warm manager's voice.`,
    "Include, in this order:",
    "1. One specific strength, quoting their own words.",
    "2. Coaching on the one or two most important gaps, ending with a question that makes them think.",
    "3. One closing line on what to carry into their account research.",
    "Never mention a score, points, a grade, a band, a rubric or a checklist. No emoji, no headings, no bullet points, no numbered lists.",
    "Do not name specific companies, cities or regions, and do not suggest a specific number of locations. Work only from their ICP and the review notes.",
  ].join("\n");
  const labels = new Map(input.rubric.criteria.map((criterion) => [criterion.id, criterion.label]));
  const review = input.criteria
    .map((result) => {
      const parts = [`- ${labels.get(result.id) ?? result.id}: ${result.verdict}`];
      if (result.evidence) {
        parts.push(`  their words: "${result.evidence}"`);
      }
      if (result.gap) {
        parts.push(`  gap: ${result.gap}`);
      }
      return parts.join("\n");
    })
    .join("\n");
  return {
    system,
    user: `Their ICP:\n\n${renderFields(input.fields)}\n\nReview notes:\n${review}`,
  };
}

// ── Note checks and fallback ───

export const countNoteWords = (note: string): number => note.trim().split(/\s+/).filter(Boolean).length;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A name as a whole word or phrase, any case. */
const nameMatcher = (name: string): RegExp => new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.trim())}($|[^a-z0-9])`, "i");

/**
 * Problems with a model-written note (empty when it can be saved): the word
 * count, the real range written as a range ("3-12", "3 to 12"), any forbidden
 * name (territory cities, directory companies), score words, emoji or headings.
 */
export function checkManagerNote(
  note: string,
  rules: {
    minWords: number;
    maxWords: number;
    realRange: readonly [number, number];
    forbiddenNames: readonly string[];
  }
): string[] {
  const problems: string[] = [];
  const words = countNoteWords(note);
  if (words < rules.minWords || words > rules.maxWords) {
    problems.push(`word count ${words}`);
  }
  const [min, max] = rules.realRange;
  if (new RegExp(`\\b${min}\\s*(?:-|–|—|to|through)\\s*${max}\\b`, "i").test(note)) {
    problems.push("real range");
  }
  const named = rules.forbiddenNames.find((name) => name.trim().length > 0 && nameMatcher(name).test(note));
  if (named) {
    problems.push(`names ${named}`);
  }
  if (/\b(score[sd]?|scoring|points?)\b/i.test(note)) {
    problems.push("score words");
  }
  // Emoji sit outside the Basic Multilingual Plane (surrogate pairs).
  if (/[\uD800-\uDFFF]/.test(note)) {
    problems.push("emoji");
  }
  if (/^\s*(#|[-*•]\s|\d+[.)]\s)/m.test(note)) {
    problems.push("heading or list");
  }
  return problems;
}

/**
 * The note built in code from the verdicts, for when the model's note fails a
 * check or step B errors: a strength quoting the highest-value met criterion,
 * the gap sentences of the two criteria that lost the most points, a question
 * and the closing line.
 */
export function buildFallbackNote(
  rubric: IcpRubric,
  criteria: readonly IcpCriterionResult[],
  copy: IcpNoteCopy
): string {
  const fullPoints = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion.points]));
  const lost = (result: IcpCriterionResult): number => (fullPoints.get(result.id) ?? 0) - result.points;
  const strength = criteria
    .filter((result) => result.verdict === "met" && result.evidence)
    .sort((a, b) => (fullPoints.get(b.id) ?? 0) - (fullPoints.get(a.id) ?? 0))[0];
  const gaps = criteria
    .filter((result) => result.verdict !== "met" && result.gap)
    .sort((a, b) => lost(b) - lost(a))
    .slice(0, 2);
  const { fallback } = copy;
  const opening = strength
    ? `${fallback.strengthLead} “${strength.evidence}”. ${fallback.strengthFollow}`
    : fallback.noStrength;
  const coaching = gaps.length
    ? [
        `${fallback.firstGapLead} ${gaps[0]?.gap ?? ""}`,
        gaps[1] ? `${fallback.secondGapLead} ${gaps[1].gap}` : "",
        fallback.gapQuestion,
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return [[opening, coaching].filter(Boolean).join(" "), fallback.closing].join("\n\n");
}

// ── Saved record ───

export type IcpGradeStatus = "graded" | "ungraded";

/** attempts.stage_data.icp. Graded once; the student only ever sees IcpNoteView. */
export type IcpGradeRecord = {
  rubricVersion: string;
  /** The ICP form fields as submitted. */
  fields: Record<string, string>;
  criteria: IcpCriterionResult[];
  /** null when ungraded. */
  score: number | null;
  band: IcpBand | null;
  note: string;
  status: IcpGradeStatus;
  gradedAt: string;
  /** True after the student clicks Continue on the note. */
  feedbackSeen: boolean;
};

/** What the student may see: the note and its state. Never the score, band or criteria. */
export type IcpNoteView = { status: IcpGradeStatus; note: string; feedbackSeen: boolean };

export function toIcpNoteView(record: IcpGradeRecord): IcpNoteView {
  return { status: record.status, note: record.note, feedbackSeen: record.feedbackSeen };
}

const BANDS: readonly IcpBand[] = ["strong", "developing", "needs_work"];

const isCriterionResult = (value: unknown): value is IcpCriterionResult => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    ICP_VERDICTS.includes(entry.verdict as IcpVerdict) &&
    typeof entry.evidence === "string" &&
    typeof entry.gap === "string" &&
    typeof entry.points === "number"
  );
};

/**
 * Reads stage_data.icp: the current record, or the old pass/fail shape
 * ({ result: "affirmed" | "corrected", displayText, feedbackSeen }) as an
 * ungraded record whose note is its fixed text. null for anything else.
 */
export function parseIcpGradeRecord(raw: unknown): IcpGradeRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const feedbackSeen = obj.feedbackSeen === true;
  if (obj.status === "graded" || obj.status === "ungraded") {
    const fields: Record<string, string> = {};
    if (obj.fields && typeof obj.fields === "object") {
      for (const [key, value] of Object.entries(obj.fields as Record<string, unknown>)) {
        if (typeof value === "string") {
          fields[key] = value;
        }
      }
    }
    return {
      rubricVersion: typeof obj.rubricVersion === "string" ? obj.rubricVersion : "",
      fields,
      criteria: Array.isArray(obj.criteria) ? obj.criteria.filter(isCriterionResult) : [],
      score: typeof obj.score === "number" && Number.isFinite(obj.score) ? obj.score : null,
      band: BANDS.includes(obj.band as IcpBand) ? (obj.band as IcpBand) : null,
      note: typeof obj.note === "string" ? obj.note : "",
      status: obj.status,
      gradedAt: typeof obj.gradedAt === "string" ? obj.gradedAt : "",
      feedbackSeen,
    };
  }
  if (obj.result === "affirmed" || obj.result === "corrected") {
    return {
      rubricVersion: "legacy",
      fields: {},
      criteria: [],
      score: null,
      band: null,
      note: typeof obj.displayText === "string" ? obj.displayText : "",
      status: "ungraded",
      gradedAt: "",
      feedbackSeen,
    };
  }
  return null;
}
