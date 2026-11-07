/**
 * data-room-chat-render.ts
 * Extractive answers for the Data Room assistant about one to three companies (pure;
 * no DB, no network; All companies: lib/data-room-chat-filter.ts). Every
 * company fact gets a stable id and a display sentence, built at read time from the
 * stored values: one fact per public attribute, one per public signal, one per
 * hidden finding (display = the stored text). The model never writes a fact and
 * can't add or remove findings: the findings the policy allows are always shown as
 * they are; the selection call sees them and the public facts, picks public fact ids
 * to add, and says whether any fact states the exact detail asked for (the selection
 * call's messages and reply parsing live here). Code keeps the ids that are in the
 * set it was given, and the renderers turn facts into the { intro, items } answer.
 * Each rendered line keeps its source (research finding, public signal or card
 * fact) for the pane's tags. The only model-written text is a one-sentence opening,
 * written last by a separate call that sees only the question, its topic and the
 * finished answer text (companies as "Company 1", "Company 2"…; its messages are
 * built here), checked here (checkOpening: it may only restate what the facts shown
 * say). Every answer with facts gets exactly one first line, decided by one function
 * (withFirstLine): its own fixed line if it has one, else the checked opening, else
 * a fixed line built by code from the answer path and the config's labels
 * (fallbackFirstLine). A follow-up that brings back only facts already shown gets a
 * fixed first line (withNothingNewIntro), and so do findings the selection call says
 * don't answer the question (withRelatedFindingsIntro, read with
 * isNoFactAnswersReply). A compare answer about 2–3 companies also carries card
 * values and signals for a side-by-side table (withCompareLayout), and only the rows
 * the question names ("only for locations", compareRowsFor). Used by POST
 * /api/student/data-room-chat.
 */

import { getDataRoomChatConfig, type DataRoomChatConfig } from "@/lib/data-room-chat-config";
import type { CompanyAllowance } from "@/lib/data-room-chat-policy";
import type { RouterAttribute, RouterDecision } from "@/lib/data-room-chat-router";
import {
  COMPARE_ROW_KEYS,
  redactCompanyMentions,
  textContainsCompanyName,
  toWords,
  type AnswerCard,
  type AnswerLine,
  type AnswerLineSource,
  type CompareRowKey,
  type FirstWordReplacement,
  type ScopedAnswer,
  type ScopedAnswerItem,
  type ScopeIndex,
} from "@/lib/data-room-chat-scope";
import type { QuestionTopic, ResearchFinding } from "@/lib/data-room-research-topics";

/** The reply for a company when no fact answers the question (or none is allowed). */
export const NOTHING_FINDABLE_REPLY = "Nothing about that is publicly findable for this company.";

/** The intro when the question asks for one exact detail that no fact states, above related facts. */
export const EXACT_DETAIL_MISSING_INTRO = "That exact detail isn't publicly findable. Related facts:";

/**
 * The first line of a compare limited to some rows ("only for locations"): fixed, so no
 * opening can mention a detail the table doesn't show.
 */
export const COMPARE_FIXED_INTRO = "Which one to pursue is your call; the facts below can help you compare.";

/** The fixed first line of an overview of one company, when no opening sentence is shown. */
export const OVERVIEW_FIRST_LINE_ONE = "Here's the public overview of this company.";
/** The fixed first line of an overview of two or three companies, when no opening sentence is shown. */
export const OVERVIEW_FIRST_LINE_SEVERAL = "Here's the public overview of these companies.";
/** The fixed first line of a selected-facts answer with no topic or card detail (a filter question about 1–3 companies). */
export const GENERIC_FIRST_LINE = "Here's what's on record for your question.";

/** The note under a research question about 2–3 companies: findings are only shared one company at a time. */
export const ONE_COMPANY_RESEARCH_NOTE = "Ask about one company at a time to see its research findings.";

/** The intro when a follow-up ("tell me more") brings back only facts the last answer already showed. */
export const FOLLOW_UP_NOTHING_NEW_INTRO = "That's everything publicly findable on this.";

/**
 * The intro when findings are shown but the selection call says no fact answers the
 * question: the findings still show (they are how trap clues stay reachable), under
 * an honest first line instead of an opening that presents them as the answer.
 */
export const RELATED_FINDINGS_INTRO = "Nothing specific on that is publicly findable. Related findings:";

// ── Facts ───

/** Public attributes, one fact each: the router's attributes plus the blurb. */
export const PUBLIC_ATTRIBUTES = [
  "industry",
  "locations",
  "metro",
  "territory",
  "online_booking",
  "size",
  "blurb",
  "contacts",
] as const satisfies readonly (RouterAttribute | "blurb")[];

export type PublicAttribute = (typeof PUBLIC_ATTRIBUTES)[number];

/** p = public attribute, s = public signal, h = hidden finding. */
export type FactKind = "p" | "s" | "h";

export type Fact = {
  /** "<companyId>:p:<attribute>", "<companyId>:s:<i>" or "<companyId>:h:<i>". */
  id: string;
  companyId: string;
  kind: FactKind;
  /** The attribute name, or the signal's / finding's stored index. */
  key: string;
  /** The sentence shown to the student (the stored text for signals and findings). */
  display: string;
};

/** The stored values one company's facts are built from. */
export type CompanyFactSource = {
  id: string;
  industry: string | null;
  vertical: string | null;
  locations: number | null;
  metro: string | null;
  inTerritory: boolean | null;
  sizeNote: string | null;
  onlineBooking: boolean | null;
  blurb: string | null;
  publicSignals: readonly string[];
  contacts: ReadonlyArray<{ name: string; title: string; department: string }>;
  /** Stored research findings (only loaded when the policy could allow them). */
  findings: readonly ResearchFinding[];
};

export type CompanyFacts = {
  companyId: string;
  /** "Industry · N locations · Metro": the overview's first line ("" when all are missing). */
  headline: string;
  /** Attribute facts that have a stored value. */
  attributes: Partial<Record<PublicAttribute, Fact>>;
  signals: Fact[];
  /** Never shown unless the policy allows them. */
  hidden: Fact[];
};

function fact(companyId: string, kind: FactKind, key: string, display: string): Fact {
  return { id: `${companyId}:${kind}:${key}`, companyId, kind, key, display };
}

/** Each fact kind's line source: a hidden finding is research, a signal public, an attribute a card fact. */
const LINE_SOURCES: Readonly<Record<FactKind, AnswerLineSource>> = { h: "research", s: "public", p: "card" };

/** A fact as one answer line: its display sentence and its source (LINE_SOURCES). */
export function factLine(entry: Fact): AnswerLine {
  return { text: entry.display, source: LINE_SOURCES[entry.kind] };
}

/** Ends a sentence built from stored values with a period (stored sentences are left as written). */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function locationCount(locations: number): string {
  return `${locations} ${locations === 1 ? "location" : "locations"}`;
}

function formatContact(contact: { name: string; title: string; department: string }): string {
  const nameAndTitle = [contact.name.trim(), contact.title.trim()].filter(Boolean).join(", ");
  const department = contact.department.trim();
  return department ? `${nameAndTitle} (${department})` : nameAndTitle;
}

/**
 * Builds one company's facts from its stored values. Attributes without a value get
 * no fact; signals and findings keep their stored text and index.
 */
export function buildCompanyFacts(source: CompanyFactSource): CompanyFacts {
  const id = source.id;
  const industry = source.vertical?.trim() ? titleCase(source.vertical.trim()) : source.industry?.trim() ?? "";
  const metro = source.metro?.trim() ?? "";
  const sizeNote = source.sizeNote?.trim() ?? "";
  const blurb = source.blurb?.trim() ?? "";
  const contacts = source.contacts
    .filter((contact) => contact.name.trim().length > 0)
    .map(formatContact)
    .sort((a, b) => a.localeCompare(b));

  const attributes: CompanyFacts["attributes"] = {};
  if (industry) {
    attributes.industry = fact(id, "p", "industry", `Industry: ${industry}.`);
  }
  if (source.locations !== null) {
    const where = metro ? ` ${source.locations === 1 ? "in" : "across"} ${metro}` : "";
    attributes.locations = fact(id, "p", "locations", `${locationCount(source.locations)}${where}.`);
  }
  if (metro) {
    attributes.metro = fact(id, "p", "metro", `Metro area: ${metro}.`);
  }
  if (source.inTerritory !== null) {
    attributes.territory = fact(id, "p", "territory", source.inTerritory ? "In territory." : "Out of territory.");
  }
  if (source.onlineBooking !== null) {
    attributes.online_booking = fact(
      id,
      "p",
      "online_booking",
      source.onlineBooking ? "Offers online booking." : "No online booking."
    );
  }
  if (sizeNote) {
    attributes.size = fact(id, "p", "size", sentence(sizeNote));
  }
  if (blurb) {
    attributes.blurb = fact(id, "p", "blurb", blurb);
  }
  if (contacts.length > 0) {
    attributes.contacts = fact(id, "p", "contacts", sentence(`Contacts: ${contacts.join("; ")}`));
  }

  return {
    companyId: id,
    headline: [industry, source.locations !== null ? locationCount(source.locations) : "", metro]
      .filter((part) => part.length > 0)
      .join(" · "),
    attributes,
    signals: source.publicSignals
      .map((signal) => signal.trim())
      .flatMap((signal, i) => (signal ? [fact(id, "s", String(i), signal)] : [])),
    hidden: source.findings.map((finding, i) => fact(id, "h", String(i), finding.text)),
  };
}

/** Every public fact: attributes in PUBLIC_ATTRIBUTES order, then the signals. */
export function publicFacts(facts: CompanyFacts): Fact[] {
  return [
    ...PUBLIC_ATTRIBUTES.flatMap((attribute) => {
      const entry = facts.attributes[attribute];
      return entry ? [entry] : [];
    }),
    ...facts.signals,
  ];
}

/** The research findings the policy allows for a company, in stored order (always shown as they are). */
export function allowedFindings(facts: CompanyFacts, allowance: CompanyAllowance | undefined): Fact[] {
  const allowedTexts = new Set((allowance?.hidden ?? []).map((finding) => finding.text));
  return facts.hidden.filter((entry) => allowedTexts.has(entry.display));
}

/** A company's public facts, when the policy allows them (the selection call picks among these to add). */
export function allowedPublicFacts(facts: CompanyFacts, allowance: CompanyAllowance | undefined): Fact[] {
  return allowance?.public ? publicFacts(facts) : [];
}

// ── Answer paths ───

/**
 * overview: rendered, no model (also compare). attribute: one sentence per company,
 * no model. select: the allowed findings as they are, then the public facts one
 * selection call picks (it sees the allowed findings and the public facts).
 */
export type AnswerPath =
  | { kind: "overview" }
  | { kind: "attribute"; attribute: RouterAttribute }
  | { kind: "select" };

/**
 * The answer path for the router's decision. compare and meta_or_bulk (and an
 * attribute lookup without an attribute) are answered as an overview; off_topic
 * never gets here (the policy replies first).
 */
export function answerPathFor(decision: RouterDecision): AnswerPath {
  switch (decision.intent) {
    case "attribute_lookup":
      return decision.attribute ? { kind: "attribute", attribute: decision.attribute } : { kind: "overview" };
    case "specific_research":
    case "filter_list":
      return { kind: "select" };
    default:
      return { kind: "overview" };
  }
}

// ── Rendering ───

/**
 * The overview in a fixed order: the headline (industry · locations · metro),
 * territory, online booking, blurb (card facts), then the public signals.
 */
export function overviewLines(facts: CompanyFacts): AnswerLine[] {
  const { territory, online_booking: onlineBooking, blurb } = facts.attributes;
  return [
    ...(facts.headline ? [{ text: facts.headline, source: "card" as const }] : []),
    ...[territory, onlineBooking, blurb, ...facts.signals].flatMap((entry) => (entry ? [factLine(entry)] : [])),
  ];
}

/** The attribute's display sentence (a card fact), or nothing when the company has no value for it. */
export function attributeLines(facts: CompanyFacts, attribute: PublicAttribute): AnswerLine[] {
  const entry = facts.attributes[attribute];
  return entry ? [factLine(entry)] : [];
}

/** One company's block: the name from the database as header, then one line per fact (with its source). */
export type CompanyBlock = { companyId: string; companyName: string; lines: readonly AnswerLine[] };

/**
 * Renders the answer. Each item's text is its lines joined (as before), and lines
 * keeps each one's source. keepEmpty: every block is shown, an empty one as the
 * nothing-findable reply (no lines). Otherwise empty blocks are left out, and if none
 * is left the intro is the nothing-findable reply. No lead-in sentences.
 */
export function renderAnswer(blocks: readonly CompanyBlock[], keepEmpty: boolean): ScopedAnswer {
  const items = blocks.flatMap((block): ScopedAnswerItem[] => {
    if (block.lines.length > 0) {
      return [
        {
          companyId: block.companyId,
          companyName: block.companyName,
          text: block.lines.map((line) => line.text).join("\n"),
          lines: block.lines.map((line) => ({ text: line.text, source: line.source })),
        },
      ];
    }
    return keepEmpty ? [{ companyId: block.companyId, companyName: block.companyName, text: NOTHING_FINDABLE_REPLY }] : [];
  });
  return items.length > 0 ? { intro: "", items } : { intro: NOTHING_FINDABLE_REPLY, items: [] };
}

/**
 * A company's card values for a compare column, from the same stored values as its
 * overview (industry: the title-cased vertical, else the industry column).
 */
export function compareCard(source: CompanyFactSource): AnswerCard {
  const industry = source.vertical?.trim() ? titleCase(source.vertical.trim()) : source.industry?.trim() ?? "";
  return {
    industry,
    locations: source.locations,
    metro: source.metro?.trim() || null,
    inTerritory: source.inTerritory,
    onlineBooking: source.onlineBooking,
  };
}

/** The words that name each compare row in a question ("only for locations", "just the signals"). */
const COMPARE_ROW_WORDS: Record<CompareRowKey, RegExp> = {
  industry: /^(?:industry|industries|vertical|verticals|sector|sectors)$/,
  locations: /^(?:loc|locs|location|locations)$/,
  city: /^(?:city|cities|metro|metros)$/,
  territory: /^(?:territory|territories)$/,
  online_booking: /^(?:booking|bookings|online)$/,
  signals: /^(?:signal|signals)$/,
};

/**
 * The compare rows a question names, in table order ("compare the 3 only for
 * locations" → locations; "just the signals" → signals); empty when it names none
 * or all of them (then every row shows).
 */
export function compareRowsFor(question: string): CompareRowKey[] {
  const words = question.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 0);
  const rows = COMPARE_ROW_KEYS.filter((key) => words.some((word) => COMPARE_ROW_WORDS[key].test(word)));
  return rows.length === COMPARE_ROW_KEYS.length ? [] : rows;
}

/**
 * A compare answer about two or three companies, shown side by side (layout
 * "compare"): each item also carries its card values and public signals; its text
 * (the overview) stays the fallback. rows: the details the question limits it to
 * (compareRowsFor; empty → every row); a limited compare starts with
 * COMPARE_FIXED_INTRO, so it gets no opening sentence. One company, or a company
 * without a source, is left as it is.
 */
export function withCompareLayout(
  answer: ScopedAnswer,
  sources: readonly CompanyFactSource[],
  rows: readonly CompareRowKey[] = []
): ScopedAnswer {
  if (answer.items.length < 2) {
    return answer;
  }
  const byId = new Map(sources.map((source) => [source.id, source]));
  if (!answer.items.every((item) => byId.has(item.companyId))) {
    return answer;
  }
  return {
    ...answer,
    layout: "compare",
    ...(rows.length > 0 ? { compareRows: [...rows], intro: COMPARE_FIXED_INTRO } : {}),
    items: answer.items.map((item) => {
      const source = byId.get(item.companyId);
      return source
        ? {
            ...item,
            card: compareCard(source),
            signals: source.publicSignals.map((signal) => signal.trim()).filter((signal) => signal.length > 0),
          }
        : item;
    }),
  };
}

/**
 * Starts the answer with EXACT_DETAIL_MISSING_INTRO when it shows at least one fact;
 * an answer with no facts keeps the nothing-findable reply as it is.
 */
export function withExactDetailIntro(answer: ScopedAnswer): ScopedAnswer {
  return hasFacts(answer) ? { ...answer, intro: EXACT_DETAIL_MISSING_INTRO } : answer;
}

/**
 * Starts the answer with RELATED_FINDINGS_INTRO when it shows at least one fact (the
 * facts stay exactly as they are: nothing hidden, removed or reordered); an answer
 * with no facts keeps the nothing-findable reply as it is.
 */
export function withRelatedFindingsIntro(answer: ScopedAnswer): ScopedAnswer {
  return hasFacts(answer) ? { ...answer, intro: RELATED_FINDINGS_INTRO } : answer;
}

/**
 * True when the answer shows at least one fact (a company block that isn't the
 * nothing-findable reply). Fixed replies and the nothing-findable reply have none.
 */
export function hasFacts(answer: ScopedAnswer): boolean {
  return answer.items.some((item) => item.text !== NOTHING_FINDABLE_REPLY);
}

/**
 * Starts a follow-up's answer with FOLLOW_UP_NOTHING_NEW_INTRO when it shows facts
 * and every line it shows was already shown for that company (shownLines: the
 * previous answer's lines by company id). An answer with something new, or with no
 * facts, is returned as it is.
 */
export function withNothingNewIntro(
  answer: ScopedAnswer,
  shownLines: ReadonlyMap<string, ReadonlySet<string>>
): ScopedAnswer {
  const factItems = answer.items.filter((item) => item.text !== NOTHING_FINDABLE_REPLY);
  const isNothingNew =
    factItems.length > 0 &&
    factItems.every((item) =>
      item.text.split("\n").every((line) => shownLines.get(item.companyId)?.has(line.trim()) ?? false)
    );
  return isNothingNew ? { ...answer, intro: FOLLOW_UP_NOTHING_NEW_INTRO } : answer;
}

// ── Opening sentence (written from the finished answer, checked here) ───

/** Longest opening sentence shown. */
export const MAX_OPENING_LENGTH = 200;

/** Shortest company-name word the check treats as distinctive (shorter ones are too common). */
const MIN_DISTINCTIVE_NAME_WORD_LETTERS = 3;

const REF_PATTERN = /\bC\d+\b/i;
/** "Company 1"-style placeholders, as the opening call sees companies. */
const PLACEHOLDER_PATTERN = /\bcompany\s*\d+\b/i;
const JUDGMENT_PATTERN =
  /\b(?:better than|the best|recommend\w*|go with|i['’]?d pick|i would pick|strong fit|good fit)\b/i;
const NUMBER_PATTERN = /\d+/g;

/**
 * Number words a fact may spell out, as the digits an opening may write instead
 * ("two locations" → 2, "eighteen months" → 18, "fourth location" → 4th).
 */
const NUMBER_WORD_DIGITS: Readonly<Record<string, string>> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
  first: "1",
  second: "2",
  third: "3",
  fourth: "4",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  eighth: "8",
  ninth: "9",
  tenth: "10",
  eleventh: "11",
  twelfth: "12",
};

/**
 * Claim words: an action, change, timing or judgment an opening may state only when
 * the facts shown state it too. Each entry matches the forms of one word stem, so
 * "praised" is allowed when a fact says "praise" and "growing" when one says
 * "growth"; "updated" is dropped when no fact says "update".
 */
const CLAIM_WORD_FORMS: readonly RegExp[] = [
  /^updat(?:e|ed|es|ing)$/,
  /^launch(?:|ed|es|ing)$/,
  /^introduc(?:e|ed|es|ing|tion|tions)$/,
  /^new(?:|ly|er|est)$/,
  /^recent(?:|ly)$/,
  /^expan(?:d|ded|ding|ds|sion|sions)$/,
  /^positive(?:|ly)$/,
  /^prais(?:e|ed|es|ing)$/,
  /^strong(?:|er|est|ly)$/,
  /^(?:grow|grows|growing|grew|grown|growth)$/,
  /^best$/,
  /^ideal(?:|ly)$/,
  /^perfect(?:|ly)$/,
];

// ── Absence claims: an opening may never say something isn't there ───

/** A negation: no, not, none, never, nothing, nobody, nor, without, cannot, or an "n't" contraction. */
const NEGATION_PATTERN = /\b(?:no|not|none|never|nothing|nobody|nor|without|cannot)\b|\b[a-z]+n['’]t\b/;

/**
 * Words that, with a negation, say something wasn't found or recorded ("not
 * mentioned", "no … listed", "isn't on record", "no information", "not known").
 */
const ABSENCE_REPORT_WORD = new RegExp(
  "^(?:mention(?:s|ed|ing)?|list(?:s|ed|ing)?|found|finds?|findable|record(?:s|ed)?|indicat(?:e|es|ed|ion|ions)|" +
    "known|knows?|note[sd]?|report(?:s|ed|ing)?|available|specified|stated|shown|shows?|disclosed|documented|" +
    "cited|referenced|provided|information|info|details?|data|evidence|signs?)$"
);

/** Words that say on their own that something is absent or unknown. */
const ABSENCE_WORD =
  /^(?:missing|absent|unknown|unlisted|unmentioned|unrecorded|unreported|unspecified|undisclosed|undocumented|unavailable)$/;

/**
 * True when the sentence says something is missing, not mentioned, not listed, not
 * found, unknown, none or not on record: a negation together with a mention / listed
 * / found / recorded / indicated / known / noted / reported / available kind of word,
 * or a word such as "missing" or "unknown". An opening can't know what isn't there
 * (the clue may simply not be shown), so this is never allowed. Restating a negative
 * card fact is fine: "This company has no online booking." has no such word.
 */
function claimsAbsence(text: string): boolean {
  const words = toWords(text);
  if (words.some((word) => ABSENCE_WORD.test(word))) {
    return true;
  }
  return NEGATION_PATTERN.test(text.toLowerCase()) && words.some((word) => ABSENCE_REPORT_WORD.test(word));
}

/** The opening call's instructions: one sentence introducing the answer it sees; no new fact, judgment or name. */
export const OPENING_SYSTEM_PROMPT = [
  'You write the opening sentence of an answer a student sees while researching companies in a sales-training Data Room. You are given the student\'s question and the exact answer text shown below your sentence; companies appear only as "Company 1", "Company 2" and so on. Reply with a single JSON object and nothing else:',
  '{"opening": string}',
  "",
  "Rules:",
  '- opening: ONE short, friendly sentence (at most 30 words) that introduces the answer. It may summarise what the answer shows (for example "Four fitness studios in Texas offer online booking.").',
  "- Never add a fact, number or detail that isn't in the answer.",
  '- Only say what the facts shown say, in their own words where you can. Never add an action, change, timing or judgment the facts don\'t state (for example "updated", "launched", "recently", "new", "positive" or "strong").',
  '- Lead with the fact that most directly answers the question. When the "Topic:" line says risks, fit or budget, lead with a concern if the answer shows one (an existing contract or vendor, a freeze, a mandate, or something not being what it seems). Never describe a concern as a positive.',
  '- For a list, use the total from the "N companies match" line, never the number of companies shown.',
  '- When the answer is about one company, call it "this company", never "one company" or "the company below".',
  '- Never judge, rank or recommend a company. Never write "better than", "the best", "recommend", "go with", "I\'d pick", "strong fit" or "good fit".',
  '- Never name a company, and never refer to one as "Company 1", "Company 2" and so on.',
  '- If the student asks which company is better, which one to pick, or whether one is a good prospect, say that call is theirs and the facts below can help (for example "Which one to pursue is your call; the facts below can help you compare.").',
].join("\n");

/** The answer as the student sees it: the intro, then each company's name over its lines. */
function shownAnswerText(intro: string, blocks: ReadonlyArray<{ name: string; text: string }>): string {
  return [intro, ...blocks.map((block) => `${block.name}\n${block.text}`)].filter((part) => part.length > 0).join("\n\n");
}

/** "Company 1", "Company 2"… for the answer's companies, in the order they appear. */
function companyLabels(answer: ScopedAnswer): Map<string, string> {
  const labels = new Map<string, string>();
  for (const item of answer.items) {
    if (!labels.has(item.companyId)) {
      labels.set(item.companyId, `Company ${labels.size + 1}`);
    }
  }
  return labels;
}

/**
 * Replaces company names for the opening call: a company in the answer becomes its
 * label, any other company "another company". An identifying first word ("Summit")
 * becomes the company whose lines it is in (ownId), else the one answer company
 * with that word, else "another company" (none in the answer) or "a company" (several).
 */
function redactForOpening(
  text: string,
  index: ScopeIndex,
  labels: ReadonlyMap<string, string>,
  ownId: string | null
): string {
  const firstWords: FirstWordReplacement[] = [];
  index.firstWordIds.forEach((ids, word) => {
    const labelled = ids.filter((id) => labels.has(id));
    const owner = ownId !== null && ids.includes(ownId) ? ownId : labelled.length === 1 ? labelled[0] : null;
    const replacement = owner
      ? labels.get(owner) ?? "a company"
      : labelled.length === 0
        ? "another company"
        : "a company";
    firstWords.push({ word, replacement, caseSensitive: false });
  });
  return redactCompanyMentions(text, index, (companyId) => labels.get(companyId) ?? "another company", firstWords);
}

/**
 * The opening call's messages, built once the answer is final: only the student's
 * question, the router's topic for it (a "Topic:" line, when there is one) and the
 * exact answer text they will see, with company names replaced by "Company 1",
 * "Company 2"… in the order the answer shows them. Nothing else (no finding the
 * answer doesn't show, no answer key).
 */
export function buildOpeningMessages(
  question: string,
  answer: ScopedAnswer,
  index: ScopeIndex,
  topic: QuestionTopic | null = null
): Array<{ role: "system" | "user"; content: string }> {
  const labels = companyLabels(answer);
  const shown = shownAnswerText(
    redactForOpening(answer.intro, index, labels, null),
    answer.items.map((item) => ({
      name: labels.get(item.companyId) ?? "",
      text: redactForOpening(item.text, index, labels, item.companyId),
    }))
  );
  const topicLine = topic ? `\nTopic: ${topic}` : "";
  return [
    { role: "system", content: OPENING_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Question: ${redactForOpening(question, index, labels, null)}${topicLine}\n\nAnswer:\n${shown}`,
    },
  ];
}

/** The opening call's sentence (trimmed), or "" when the reply isn't {"opening": string}. */
export function parseOpening(raw: string | null | undefined): string {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    const opening =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).opening
        : undefined;
    return typeof opening === "string" ? opening.trim() : "";
  } catch {
    return "";
  }
}

/** More than one sentence: a sentence end (. ! ?) before the end of the text, or a line break. */
function isMoreThanOneSentence(text: string): boolean {
  const body = text.replace(/[.!?…"'”’)\s]+$/, "");
  return /\n/.test(body) || /[.!?…](?=\s)/.test(body);
}

/** Non-generic words of any roster company name (generic words come from the roster itself). */
function distinctiveNameWords(index: ScopeIndex): Set<string> {
  const words = new Set<string>();
  index.nameWordsById.forEach((nameWords) => {
    for (const word of nameWords) {
      if (word.length >= MIN_DISTINCTIVE_NAME_WORD_LETTERS && !index.genericWords.has(word)) {
        words.add(word);
      }
    }
  });
  return words;
}

/** The first word of every roster company name: never allowed in an opening, even when a fact uses it. */
function nameFirstWords(index: ScopeIndex): Set<string> {
  const words = new Set<string>();
  index.nameWordsById.forEach((nameWords) => {
    if (nameWords[0]) {
      words.add(nameWords[0]);
    }
  });
  return words;
}

/** The digits in a text, plus the digits of the number words it spells out. */
function numbersIn(text: string): string[] {
  return [
    ...(text.match(NUMBER_PATTERN) ?? []),
    ...toWords(text).flatMap((word) => (NUMBER_WORD_DIGITS[word] ? [NUMBER_WORD_DIGITS[word]] : [])),
  ];
}

/** Why an opening is dropped (shown in the server log), or null when it passes every check. */
export type OpeningRejection =
  | "empty"
  | "too long"
  | "more than one sentence"
  | "ref or placeholder"
  | "judgment"
  | "company name"
  | "company-name word"
  | "number not shown"
  | "claim not in the facts"
  | "claims something is absent";

/**
 * The first check the opening fails, or null when it passes them all. Dropped when it
 * is empty, over 200 characters or more than one sentence; mentions a ref (C1, [C1])
 * or a "Company 1"-style placeholder; judges a company (better than, the best,
 * recommend, go with, I'd pick, strong fit, good fit); mentions a full roster company
 * name, or a distinctive company-name word — unless the student used that word in the
 * question, or the facts shown use it and it isn't the first word of a name; has a
 * number that is in neither the answer (as the student sees it, number words
 * included: "two" allows 2) nor the question; uses a claim word ("updated",
 * "new", "positive", "growing"…) whose stem the facts shown don't use; or says
 * something is missing, not mentioned, not listed, not found, unknown, none or not on
 * record (claimsAbsence; 2026-11-08: Kestrel, "There's no locked-in contract or vendor
 * mentioned for this company." above an answer whose hidden clue is a multi-year
 * vendor agreement).
 */
export function openingRejection(
  opening: string,
  question: string,
  answer: ScopedAnswer,
  index: ScopeIndex
): OpeningRejection | null {
  const text = opening.trim();
  if (!text) {
    return "empty";
  }
  if (text.length > MAX_OPENING_LENGTH) {
    return "too long";
  }
  if (isMoreThanOneSentence(text)) {
    return "more than one sentence";
  }
  if (REF_PATTERN.test(text) || PLACEHOLDER_PATTERN.test(text)) {
    return "ref or placeholder";
  }
  if (JUDGMENT_PATTERN.test(text)) {
    return "judgment";
  }
  if (index.companies.some((company) => textContainsCompanyName(index, text, company.id))) {
    return "company name";
  }
  const openingWords = toWords(text);
  const questionWords = new Set(toWords(question));
  // The facts as the student sees them (no headers): a word repeated from them names
  // no company, unless it is a name's first word.
  const factWords = toWords(answer.items.map((item) => item.text).join("\n"));
  const allowedFactWords = new Set(factWords);
  nameFirstWords(index).forEach((word) => allowedFactWords.delete(word));
  const distinctive = distinctiveNameWords(index);
  if (
    openingWords.some((word) => distinctive.has(word) && !questionWords.has(word) && !allowedFactWords.has(word))
  ) {
    return "company-name word";
  }
  const shown = shownAnswerText(
    answer.intro,
    answer.items.map((item) => ({ name: item.companyName, text: item.text }))
  );
  const knownNumbers = new Set([...numbersIn(question), ...numbersIn(shown)]);
  if ((text.match(NUMBER_PATTERN) ?? []).some((number) => !knownNumbers.has(number))) {
    return "number not shown";
  }
  const isUnstatedClaim = (word: string): boolean => {
    const forms = CLAIM_WORD_FORMS.find((pattern) => pattern.test(word));
    return forms !== undefined && !factWords.some((factWord) => forms.test(factWord));
  };
  if (openingWords.some(isUnstatedClaim)) {
    return "claim not in the facts";
  }
  if (claimsAbsence(text)) {
    return "claims something is absent";
  }
  return null;
}

/**
 * The opening sentence (trimmed) if it passes every check (openingRejection), else
 * null: then no opening is shown — never a fallback.
 */
export function checkOpening(
  opening: string,
  question: string,
  answer: ScopedAnswer,
  index: ScopeIndex
): string | null {
  return openingRejection(opening, question, answer, index) === null ? opening.trim() : null;
}

/**
 * True when the answer still needs its first line (so the opening call is made): it
 * shows facts and has no first line of its own. An answer that already starts with a
 * fixed line (a filter list's "{n} companies match.", the exact-detail line, the
 * "nothing hidden" line, the related-findings line, the follow-up's "That's
 * everything publicly findable on this.", a limited compare's line) or shows no facts
 * (the nothing-findable reply, any fixed reply) needs none, so its first line is
 * never doubled.
 */
export function needsOpening(answer: ScopedAnswer): boolean {
  return hasFacts(answer) && answer.intro === "";
}

/**
 * The one place an answer's first line is decided: an answer with no facts, or with
 * its own first line already, is returned as it is; otherwise the checked opening
 * (when there is one) or else the fixed fallback line becomes its intro. So every
 * answer with facts ends with exactly one first line, and none gets two.
 */
export function withFirstLine(answer: ScopedAnswer, opening: string | null, fallback: string): ScopedAnswer {
  if (!needsOpening(answer)) {
    return answer;
  }
  return { ...answer, intro: opening || fallback };
}

/**
 * The fixed first line for an answer whose opening was dropped or failed, built by
 * code from the answer path (answerPathFor) and the config's labels:
 * - attribute lookup: "Here's what's on record for {attribute label}.";
 * - selected facts: "Here's what's publicly findable about {topic label}." (with no
 *   topic, the card detail's line, else GENERIC_FIRST_LINE);
 * - a side-by-side compare (layout "compare"): COMPARE_FIXED_INTRO;
 * - an overview: OVERVIEW_FIRST_LINE_ONE (one company) or OVERVIEW_FIRST_LINE_SEVERAL.
 */
export function fallbackFirstLine(
  decision: RouterDecision,
  answer: ScopedAnswer,
  config: DataRoomChatConfig = getDataRoomChatConfig()
): string {
  const cardLine = (attribute: RouterAttribute): string => `Here's what's on record for ${config.attributeLabels[attribute]}.`;
  const path = answerPathFor(decision);
  if (path.kind === "attribute") {
    return cardLine(path.attribute);
  }
  if (path.kind === "select") {
    if (decision.topic) {
      return `Here's what's publicly findable about ${config.topicLabels[decision.topic]}.`;
    }
    return decision.attribute ? cardLine(decision.attribute) : GENERIC_FIRST_LINE;
  }
  if (answer.layout === "compare") {
    return COMPARE_FIXED_INTRO;
  }
  return answer.items.length > 1 ? OVERVIEW_FIRST_LINE_SEVERAL : OVERVIEW_FIRST_LINE_ONE;
}

// ── Selection call ───

/**
 * The selection call's instructions: choose fact ids that actually answer the
 * question (none is fine) and say whether one is exact; never write an answer.
 */
export const SELECTION_SYSTEM_PROMPT = [
  'You choose facts that answer a student\'s question in a sales-training Data Room. Each line under "Facts" is one fact, written as "id: fact". Companies appear only as references such as C1, in the ids and in the question.',
  "Reply with a single JSON object and nothing else:",
  '{"fact_ids": string[], "exact_answer": boolean}',
  "",
  "Rules:",
  "- fact_ids: the ids of the facts that answer the question, most relevant first. Copy each id exactly as written; use only ids from the list.",
  "- Choose only facts that answer the question. If it is about several companies, choose the facts that answer it for the companies listed.",
  "- Choose a fact only if it actually answers the question. A fact about a different subject never answers it, even when it is the only fact listed for a company; returning no facts is fine.",
  "- A fact also answers the question when it settles it indirectly, for example a rule, contract, mandate, agreement, freeze or restriction that decides who chooses, what they use, what they can spend or whether something will change.",
  "- exact_answer: true only if a listed fact states exactly what was asked (for example the number, amount or count, the email address or phone number, or the named vendor or product); false otherwise.",
  '- If no fact answers the question, reply {"fact_ids": [], "exact_answer": false}.',
  "- If the exact thing asked for (for example an email address, a revenue number or a count) isn't stated in the facts, set exact_answer to false and choose only facts genuinely related to it (about the same subject); if none are, return no facts rather than loosely related ones.",
  "- Never rank, recommend or judge the companies; only choose facts.",
].join("\n");

/** A fact as the selection call sees it: a ref-based id and name-redacted text. */
export type SelectableFact = {
  fact: Fact;
  /** "<ref>:<kind>:<key>", e.g. "C1:p:locations" (no database ids reach the model). */
  promptId: string;
  promptText: string;
};

/** The facts for the selection call, labelled with the company's ref ("C1:p:locations"). */
export function toSelectableFacts(
  facts: readonly Fact[],
  ref: string,
  redact: (text: string) => string
): SelectableFact[] {
  return facts.map((entry) => ({
    fact: entry,
    promptId: `${ref}:${entry.kind}:${entry.key}`,
    promptText: redact(entry.display),
  }));
}

/** The selection call's messages: the redacted question and the allowed facts only (findings and public facts). */
export function buildSelectionMessages(
  question: string,
  facts: readonly SelectableFact[]
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SELECTION_SYSTEM_PROMPT },
    {
      role: "user",
      content: [`Question: ${question}`, "Facts:", ...facts.map((entry) => `${entry.promptId}: ${entry.promptText}`)].join(
        "\n"
      ),
    },
  ];
}

/** The selection call's reply: the facts it picked and whether one states the exact detail asked. */
export type Selection = { facts: Fact[]; exactAnswer: boolean };

/**
 * The selected facts, in the model's order: ids not among the facts it was given
 * (foreign, disallowed or invented) and repeats are dropped. exactAnswer is true only
 * when exact_answer is exactly true. Invalid JSON or a wrong shape selects nothing.
 */
export function parseSelection(raw: string | null | undefined, facts: readonly SelectableFact[]): Selection {
  const none: Selection = { facts: [], exactAnswer: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return none;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return none;
  }
  const { fact_ids: ids, exact_answer: exactAnswer } = parsed as Record<string, unknown>;
  if (!Array.isArray(ids)) {
    return none;
  }
  const byPromptId = new Map(facts.map((entry) => [entry.promptId, entry.fact]));
  const selected: Fact[] = [];
  for (const id of ids) {
    const entry = typeof id === "string" ? byPromptId.get(id.trim()) : undefined;
    if (entry && !selected.includes(entry)) {
      selected.push(entry);
    }
  }
  return { facts: selected, exactAnswer: exactAnswer === true };
}

/**
 * True only when the selection call's reply is its "no fact answers the question"
 * reply, as the prompt words it: {"fact_ids": [], "exact_answer": false} (an empty
 * id list and exact_answer exactly false). Invalid JSON, a wrong shape, a missing
 * exact_answer, any id at all (even one that isn't among the facts given) or
 * exact_answer true → false, so an unclear reply changes nothing.
 */
export function isNoFactAnswersReply(raw: string | null | undefined): boolean {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const { fact_ids: ids, exact_answer: exactAnswer } = parsed as Record<string, unknown>;
    return Array.isArray(ids) && ids.length === 0 && exactAnswer === false;
  } catch {
    return false;
  }
}
