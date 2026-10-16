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
 * The only model-written text is a one-sentence opening, written last by a separate
 * call that sees only the question and the finished answer text (companies as
 * "Company 1", "Company 2"…; its messages are built here), checked here
 * (checkOpening) and placed above the facts (withOpening; also used for
 * All-companies lists). Used by POST /api/student/data-room-chat.
 */

import type { CompanyAllowance } from "@/lib/data-room-chat-policy";
import type { RouterAttribute, RouterDecision } from "@/lib/data-room-chat-router";
import {
  redactCompanyMentions,
  textContainsCompanyName,
  toWords,
  type FirstWordReplacement,
  type ScopedAnswer,
  type ScopeIndex,
} from "@/lib/data-room-chat-scope";
import type { ResearchFinding } from "@/lib/data-room-research-topics";

/** The reply for a company when no fact answers the question (or none is allowed). */
export const NOTHING_FINDABLE_REPLY = "Nothing about that is publicly findable for this company.";

/** The intro when the question asks for one exact detail that no fact states, above related facts. */
export const EXACT_DETAIL_MISSING_INTRO = "That exact detail isn't publicly findable. Related facts:";

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
 * territory, online booking, blurb, public signals.
 */
export function overviewLines(facts: CompanyFacts): string[] {
  const { territory, online_booking: onlineBooking, blurb } = facts.attributes;
  return [
    ...(facts.headline ? [facts.headline] : []),
    ...[territory, onlineBooking, blurb, ...facts.signals].flatMap((entry) => (entry ? [entry.display] : [])),
  ];
}

/** The attribute's display sentence, or nothing when the company has no value for it. */
export function attributeLines(facts: CompanyFacts, attribute: PublicAttribute): string[] {
  const entry = facts.attributes[attribute];
  return entry ? [entry.display] : [];
}

/** One company's block: the name from the database as header, then one line per fact. */
export type CompanyBlock = { companyId: string; companyName: string; lines: readonly string[] };

/**
 * Renders the answer. keepEmpty: every block is shown, an empty one as the
 * nothing-findable reply. Otherwise empty blocks are left out, and if none is left
 * the intro is the nothing-findable reply. No lead-in sentences.
 */
export function renderAnswer(blocks: readonly CompanyBlock[], keepEmpty: boolean): ScopedAnswer {
  const items = blocks.flatMap((block) =>
    block.lines.length > 0 || keepEmpty
      ? [
          {
            companyId: block.companyId,
            companyName: block.companyName,
            text: block.lines.length > 0 ? block.lines.join("\n") : NOTHING_FINDABLE_REPLY,
          },
        ]
      : []
  );
  return items.length > 0 ? { intro: "", items } : { intro: NOTHING_FINDABLE_REPLY, items: [] };
}

/**
 * Starts the answer with EXACT_DETAIL_MISSING_INTRO when it shows at least one fact;
 * an answer with no facts keeps the nothing-findable reply as it is.
 */
export function withExactDetailIntro(answer: ScopedAnswer): ScopedAnswer {
  return hasFacts(answer) ? { ...answer, intro: EXACT_DETAIL_MISSING_INTRO } : answer;
}

/**
 * True when the answer shows at least one fact (a company block that isn't the
 * nothing-findable reply). Fixed replies and the nothing-findable reply have none.
 */
export function hasFacts(answer: ScopedAnswer): boolean {
  return answer.items.some((item) => item.text !== NOTHING_FINDABLE_REPLY);
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

/** The opening call's instructions: one sentence introducing the answer it sees; no new fact, judgment or name. */
export const OPENING_SYSTEM_PROMPT = [
  'You write the opening sentence of an answer a student sees while researching companies in a sales-training Data Room. You are given the student\'s question and the exact answer text shown below your sentence; companies appear only as "Company 1", "Company 2" and so on. Reply with a single JSON object and nothing else:',
  '{"opening": string}',
  "",
  "Rules:",
  '- opening: ONE short, friendly sentence (at most 30 words) that introduces the answer. It may summarise what the answer shows (for example "Four dental companies in Colorado offer online booking.").',
  "- Never add a fact, number or detail that isn't in the answer.",
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
 * question and the exact answer text they will see, with company names replaced
 * by "Company 1", "Company 2"… in the order the answer shows them. Nothing else
 * (no finding the answer doesn't show, no answer key).
 */
export function buildOpeningMessages(
  question: string,
  answer: ScopedAnswer,
  index: ScopeIndex
): Array<{ role: "system" | "user"; content: string }> {
  const labels = companyLabels(answer);
  const shown = shownAnswerText(
    redactForOpening(answer.intro, index, labels, null),
    answer.items.map((item) => ({
      name: labels.get(item.companyId) ?? "",
      text: redactForOpening(item.text, index, labels, item.companyId),
    }))
  );
  return [
    { role: "system", content: OPENING_SYSTEM_PROMPT },
    { role: "user", content: `Question: ${redactForOpening(question, index, labels, null)}\n\nAnswer:\n${shown}` },
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

/**
 * The opening sentence if it passes every check, else null (then no opening is
 * shown — never a fallback). Dropped when it is over 200 characters or more than
 * one sentence; mentions a ref (C1, [C1]), a "Company 1"-style placeholder, a full
 * roster company name, or a distinctive company-name word (words the student used
 * in the question are allowed); has a number that isn't in the answer (as the
 * student sees it) or the question; or judges a company (better than, the best,
 * recommend, go with, I'd pick, strong fit, good fit).
 */
export function checkOpening(
  opening: string,
  question: string,
  answer: ScopedAnswer,
  index: ScopeIndex
): string | null {
  const text = opening.trim();
  if (!text || text.length > MAX_OPENING_LENGTH || isMoreThanOneSentence(text)) {
    return null;
  }
  if (REF_PATTERN.test(text) || PLACEHOLDER_PATTERN.test(text) || JUDGMENT_PATTERN.test(text)) {
    return null;
  }
  if (index.companies.some((company) => textContainsCompanyName(index, text, company.id))) {
    return null;
  }
  const questionWords = new Set(toWords(question));
  const distinctive = distinctiveNameWords(index);
  if (toWords(text).some((word) => distinctive.has(word) && !questionWords.has(word))) {
    return null;
  }
  const shown = shownAnswerText(
    answer.intro,
    answer.items.map((item) => ({ name: item.companyName, text: item.text }))
  );
  const knownNumbers = new Set([...(question.match(NUMBER_PATTERN) ?? []), ...(shown.match(NUMBER_PATTERN) ?? [])]);
  if ((text.match(NUMBER_PATTERN) ?? []).some((number) => !knownNumbers.has(number))) {
    return null;
  }
  return text;
}

/**
 * Puts the checked opening above an answer that shows facts — above the facts, or
 * above an intro line already there ("{n} companies match.", or the exact-detail
 * line, which stays). Never on an answer with no facts: the nothing-findable reply
 * or a fixed reply (off-topic, out of scope, the All-companies reply, no matches).
 */
export function withOpening(answer: ScopedAnswer, opening: string | null): ScopedAnswer {
  if (!opening || !hasFacts(answer)) {
    return answer;
  }
  return { ...answer, intro: answer.intro ? `${opening}\n${answer.intro}` : opening };
}

// ── Selection call ───

/** The selection call's instructions: choose fact ids and say whether one is exact; never write an answer. */
export const SELECTION_SYSTEM_PROMPT = [
  'You choose facts that answer a student\'s question in a sales-training Data Room. Each line under "Facts" is one fact, written as "id: fact". Companies appear only as references such as C1, in the ids and in the question.',
  "Reply with a single JSON object and nothing else:",
  '{"fact_ids": string[], "exact_answer": boolean}',
  "",
  "Rules:",
  "- fact_ids: the ids of the facts that answer the question, most relevant first. Copy each id exactly as written; use only ids from the list.",
  "- Choose only facts that answer the question. If it is about several companies, choose the facts that answer it for the companies listed.",
  "- exact_answer: true only if a listed fact states exactly what was asked (for example the number, amount or count, the email address or phone number, or the named vendor or product); false otherwise.",
  '- If no fact answers the question, reply {"fact_ids": [], "exact_answer": false}.',
  "- If the exact thing asked for (for example an email address, a revenue number or a count) isn't stated in the facts, set exact_answer to false and return no facts rather than loosely related ones.",
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
