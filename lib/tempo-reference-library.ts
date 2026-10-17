/**
 * tempo-reference-library.ts
 * Data and pure helpers for the Tempo Reference Library — one shared drawer
 * (components/tempo/TempoReferenceLibrary.tsx) that every Tempo stage renders.
 * The server page (app/student/simulation/[id]/page.tsx) builds a
 * ReferenceLibraryData from the attempt's stage_data (the ICP) and stage_scores
 * (each finished call's saved transcript payload) and passes it to the stage.
 * Sections: Prospecting (ICP + reading list), the Discovery and Objection
 * Handling calls (transcript; "Upcoming" until the call is saved) and, from the
 * Negotiation stage on, Negotiation. No answer-key data is read here.
 */

import { DISCOVERY_PERSONA, parseDiscoveryTranscript } from "@/lib/tempo-discovery";
import { OBJECTION_PERSONA, parseObjectionTranscript } from "@/lib/tempo-objections";
import { readIcpFormFields, type ProspectingWizardState } from "@/lib/tempo-prospecting";

// ── Shape ───

/** The stage the student is on (decides which sections show and which starts open). */
export type ReferenceLibraryStage = "prospecting" | "discovery" | "presentation" | "objections" | "negotiation";

export type ReferenceCallStage = "discovery" | "objections";

export type ReferenceSectionId = "prospecting" | ReferenceCallStage | "negotiation";

/** One "Your ICP" row; empty fields get no row. */
export type ReferenceIcpRow = { label: string; value: string };

export type ReferenceTranscriptMessage = {
  speaker: "persona" | "student";
  /** The persona's name, or "You" for the student. */
  name: string;
  timestamp: string;
  content: string;
};

/** A finished (saved) call. */
export type ReferenceCall = {
  stage: ReferenceCallStage;
  personaName: string;
  personaRole: string;
  /** Whole minutes from the saved call duration; null when none was saved. */
  durationMinutes: number | null;
  messages: ReferenceTranscriptMessage[];
};

export type ReferenceLibraryData = {
  currentStage: ReferenceLibraryStage;
  icpRows: ReferenceIcpRow[];
  /** null until the call is saved to stage_scores ("Upcoming"). */
  discovery: ReferenceCall | null;
  objections: ReferenceCall | null;
};

type IcpFields = Pick<
  ProspectingWizardState,
  | "icpTargetVerticals"
  | "icpDecisionMakerRole"
  | "icpSizeMinLocations"
  | "icpSizeMaxLocations"
  | "icpOperationalSignals"
  | "icpDisqualifier1"
  | "icpDisqualifier2"
  | "icpDisqualifier3"
>;

const SECONDS_PER_MINUTE = 60;

// ── Prospecting ───

/**
 * The student's ICP as label/value rows (target industry, decision-maker role,
 * size range, signals that predict fit, disqualifiers); empty fields are left out.
 */
export function buildIcpRows(fields: IcpFields): ReferenceIcpRow[] {
  const min = fields.icpSizeMinLocations.trim();
  const max = fields.icpSizeMaxLocations.trim();
  const disqualifiers = [fields.icpDisqualifier1, fields.icpDisqualifier2, fields.icpDisqualifier3]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const rows: ReferenceIcpRow[] = [
    { label: "Target industry", value: fields.icpTargetVerticals.trim() },
    { label: "Decision-maker role", value: fields.icpDecisionMakerRole.trim() },
    { label: "Size range", value: min || max ? `${min || "—"} – ${max || "—"} locations` : "" },
    { label: "Signals that predict fit", value: fields.icpOperationalSignals.trim() },
    { label: "Disqualifiers", value: disqualifiers.join("\n") },
  ];
  return rows.filter((row) => row.value.length > 0);
}

// ── Calls ───

function parseJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text?.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One saved entry as a message; Discovery's "dana" and Objections' "drKim" are both the persona. */
function toMessage(raw: unknown, personaName: string): ReferenceTranscriptMessage[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const { role, content, timestamp } = raw as Record<string, unknown>;
  if (typeof content !== "string" || content.trim().length === 0) {
    return [];
  }
  const isStudent = role === "student";
  return [
    {
      speaker: isStudent ? "student" : "persona",
      name: isStudent ? "You" : personaName,
      timestamp: typeof timestamp === "string" ? timestamp : "",
      content: content.trim(),
    },
  ];
}

/**
 * A finished call from its saved stage_scores transcript payload
 * ({ callDurationSeconds, transcript, transcriptEntries }, as both call stages
 * save it). Entries come from transcriptEntries; an older payload with only the
 * plain-text transcript is split into lines. Anything unreadable gives no messages.
 */
export function parseReferenceCall(
  stage: ReferenceCallStage,
  transcript: string | null | undefined
): ReferenceCall {
  const persona = stage === "discovery" ? DISCOVERY_PERSONA : OBJECTION_PERSONA;
  const payload = parseJsonObject(transcript);
  const rawSeconds = payload?.callDurationSeconds;
  const seconds = typeof rawSeconds === "number" && Number.isFinite(rawSeconds) && rawSeconds >= 0 ? rawSeconds : null;
  const parseText = stage === "discovery" ? parseDiscoveryTranscript : parseObjectionTranscript;
  const rawEntries: unknown[] = Array.isArray(payload?.transcriptEntries)
    ? payload.transcriptEntries
    : typeof payload?.transcript === "string"
      ? parseText(payload.transcript, seconds ?? 0)
      : [];
  return {
    stage,
    personaName: persona.name,
    personaRole: persona.role,
    // A call under a minute still reads as 1 min.
    durationMinutes:
      seconds === null ? null : seconds > 0 ? Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE)) : 0,
    messages: rawEntries.flatMap((entry) => toMessage(entry, persona.name)),
  };
}

/** The pill on a call section: "Call · 14 min" when saved (just "Call" with no duration), else "Upcoming". */
export function callPillLabel(call: ReferenceCall | null): string {
  if (!call) {
    return "Upcoming";
  }
  return call.durationMinutes === null ? "Call" : `Call · ${call.durationMinutes} min`;
}

// ── Library ───

type StageScoreRow = { stage: string; transcript: string | null };

/**
 * Builds the library for the server page: the ICP from stage_data, and each
 * call from its stage_scores row (null — "Upcoming" — when there is none yet).
 */
export function buildReferenceLibrary(input: {
  currentStage: ReferenceLibraryStage;
  stageData: Record<string, unknown>;
  scores: readonly StageScoreRow[];
}): ReferenceLibraryData {
  const callFor = (stage: ReferenceCallStage): ReferenceCall | null => {
    const row = input.scores.find((score) => score.stage === stage);
    return row ? parseReferenceCall(stage, row.transcript) : null;
  };
  return {
    currentStage: input.currentStage,
    icpRows: buildIcpRows(readIcpFormFields(input.stageData)),
    discovery: callFor("discovery"),
    objections: callFor("objections"),
  };
}

/** The sections shown on a stage: Negotiation joins only from the Negotiation stage on. */
export function visibleReferenceSections(currentStage: ReferenceLibraryStage): ReferenceSectionId[] {
  const sections: ReferenceSectionId[] = ["prospecting", "discovery", "objections"];
  return currentStage === "negotiation" ? [...sections, "negotiation"] : sections;
}

/**
 * The section that starts open: the current stage's own section. Presentation has
 * none, so the call just before it (Discovery) opens there.
 */
export function defaultOpenReferenceSection(currentStage: ReferenceLibraryStage): ReferenceSectionId {
  return currentStage === "presentation" ? "discovery" : currentStage;
}

// ── Transcript search ───

/** Messages whose text contains the query (any case); an empty query keeps them all. */
export function filterTranscript(
  messages: readonly ReferenceTranscriptMessage[],
  query: string
): ReferenceTranscriptMessage[] {
  const needle = query.trim().toLowerCase();
  return needle ? messages.filter((message) => message.content.toLowerCase().includes(needle)) : [...messages];
}

/** Splits text into plain and matching parts (any case) so the matches can be highlighted. */
export function highlightParts(text: string, query: string): Array<{ text: string; isMatch: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [{ text, isMatch: false }];
  }
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; isMatch: boolean }> = [];
  let start = 0;
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > start) {
      parts.push({ text: text.slice(start, index), isMatch: false });
    }
    parts.push({ text: text.slice(index, index + needle.length), isMatch: true });
    start = index + needle.length;
    index = lower.indexOf(needle, start);
  }
  if (start < text.length) {
    parts.push({ text: text.slice(start), isMatch: false });
  }
  return parts;
}
