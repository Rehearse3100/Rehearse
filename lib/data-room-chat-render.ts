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
 * The only model-written text is the router's one-sentence opening, which is
 * checked here (checkOpening) and placed above the facts (withOpening; also used for
 * All-companies lists). Used by POST /api/student/data-room-chat.
 */

import type { CompanyAllowance } from "@/lib/data-room-chat-policy";
import type { RouterAttribute, RouterDecision } from "@/lib/data-room-chat-router";
import {
  textContainsCompanyName,
  toWords,
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

/** True when the answer shows at least one fact (not only nothing-findable blocks or a fixed reply). */
function hasFacts(answer: ScopedAnswer): boolean {
  return answer.items.some((item) => item.text !== NOTHING_FINDABLE_REPLY);
}

// ── Opening sentence (written by the router, checked here) ───

/** Longest opening sentence shown. */
export const MAX_OPENING_LENGTH = 200;

/** Shortest company-name word the check treats as distinctive (shorter ones are too common). */
const MIN_DISTINCTIVE_NAME_WORD_LETTERS = 3;

const REF_PATTERN = /\bC\d+\b/i;
const JUDGMENT_PATTERN = /\b(?:better than|the best|recommend\w*|go with|i['’]?d pick|i would pick)\b/i;
const NUMBER_PATTERN = /\d+/g;

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
 * The router's opening sentence if it passes every check, else null (then no intro
 * is shown — never a fallback). Dropped when it is over 200 characters or more than
 * one sentence; mentions a ref (C1, [C1]), a full roster company name, or a
 * distinctive company-name word (words the student used in the question are
 * allowed); has a number that isn't in the question; or judges a company (better
 * than, the best, recommend, go with, I'd pick).
 */
export function checkOpening(opening: string, question: string, index: ScopeIndex): string | null {
  const text = opening.trim();
  if (!text || text.length > MAX_OPENING_LENGTH || isMoreThanOneSentence(text)) {
    return null;
  }
  if (REF_PATTERN.test(text) || JUDGMENT_PATTERN.test(text)) {
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
  const questionNumbers = new Set(question.match(NUMBER_PATTERN) ?? []);
  if ((text.match(NUMBER_PATTERN) ?? []).some((number) => !questionNumbers.has(number))) {
    return null;
  }
  return text;
}

/**
 * Puts the checked opening above an answer that shows facts — above the facts, or
 * above an intro line already there (e.g. "{n} companies match."). Never above a
 * nothing-findable reply or the exact-detail intro (they stay instead), nor on a
 * fixed reply with no facts (off-topic, the All-companies reply, no matches).
 */
export function withOpening(answer: ScopedAnswer, opening: string | null): ScopedAnswer {
  if (!opening || !hasFacts(answer) || answer.intro.startsWith(EXACT_DETAIL_MISSING_INTRO)) {
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
