/**
 * data-room-chat-render.ts
 * Extractive answers for the Data Room assistant (pure; no DB, no network). Every
 * company fact gets a stable id and a display sentence, built at read time from the
 * stored values: one fact per public attribute, one per public signal, one per
 * hidden finding (display = the stored text). The model never writes an answer: it
 * only selects fact ids (the selection call's messages and reply parsing live here),
 * code keeps the ids that are in the allowed set, and the renderers turn facts into
 * the { intro, items } answer. Used by POST /api/student/data-room-chat; the local
 * eval maps rendered lines back to fact ids.
 */

import type { CompanyAllowance } from "@/lib/data-room-chat-policy";
import type { RouterAttribute, RouterDecision } from "@/lib/data-room-chat-router";
import type { ScopedAnswer } from "@/lib/data-room-chat-scope";
import type { ResearchFinding } from "@/lib/tempo-research-topics";

/** The reply for a company when no fact answers the question (or none is allowed). */
export const NOTHING_FINDABLE_REPLY = "Nothing about that is publicly findable for this company.";

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

/**
 * The facts the selection call may see for a company: its public facts (when the
 * policy allows them) and only the hidden findings the policy allows.
 */
export function allowedCompanyFacts(facts: CompanyFacts, allowance: CompanyAllowance | undefined): Fact[] {
  if (!allowance) {
    return [];
  }
  const hiddenTexts = new Set(allowance.hidden.map((finding) => finding.text));
  return [
    ...(allowance.public ? publicFacts(facts) : []),
    ...facts.hidden.filter((entry) => hiddenTexts.has(entry.display)),
  ];
}

// ── Answer paths ───

/**
 * overview: rendered, no model. attribute: one sentence per company, no model.
 * select_once: one selection call over every company's allowed facts.
 * select_each: one selection call per company (compare).
 */
export type AnswerPath =
  | { kind: "overview" }
  | { kind: "attribute"; attribute: RouterAttribute }
  | { kind: "select_once" }
  | { kind: "select_each" };

/**
 * The answer path for the router's decision. meta_or_bulk (and an attribute lookup
 * without an attribute) is answered as an overview; off_topic never gets here (the
 * policy replies first).
 */
export function answerPathFor(decision: RouterDecision): AnswerPath {
  switch (decision.intent) {
    case "attribute_lookup":
      return decision.attribute ? { kind: "attribute", attribute: decision.attribute } : { kind: "overview" };
    case "specific_research":
    case "filter_list":
      return { kind: "select_once" };
    case "compare":
      return { kind: "select_each" };
    default:
      return { kind: "overview" };
  }
}

// ── Rendering ───

/**
 * The overview in a fixed order: the headline (industry · locations · metro),
 * territory, online booking, blurb, public signals. Headline only for All companies.
 */
export function overviewLines(facts: CompanyFacts, isHeadlineOnly: boolean): string[] {
  const headline = facts.headline ? [facts.headline] : [];
  if (isHeadlineOnly) {
    return headline;
  }
  const { territory, online_booking: onlineBooking, blurb } = facts.attributes;
  return [
    ...headline,
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

// ── Selection call ───

/** The selection call's instructions: choose fact ids, never write an answer. */
export const SELECTION_SYSTEM_PROMPT = [
  'You choose facts that answer a student\'s question in a sales-training Data Room. Each line under "Facts" is one fact, written as "id: fact". Companies appear only as references such as C1, in the ids and in the question.',
  "Reply with a single JSON object and nothing else:",
  '{"fact_ids": string[], "no_relevant_facts": boolean}',
  "",
  "Rules:",
  "- fact_ids: the ids of the facts that answer the question, most relevant first. Copy each id exactly as written; use only ids from the list.",
  "- Choose only facts that answer the question. If it is about several companies, choose the facts that answer it for the companies listed.",
  '- If no fact answers the question, reply {"fact_ids": [], "no_relevant_facts": true}.',
  "- Never rank, recommend or judge the companies; only choose facts.",
].join("\n");

/** A fact as the selection call sees it: a ref-based id and name-redacted text. */
export type SelectableFact = {
  fact: Fact;
  /** "<ref>:<kind>:<key>", e.g. "C1:p:locations" (no database ids reach the model). */
  promptId: string;
  promptText: string;
};

/** The facts for the selection call, labelled with the company's ref ("C1:h:2"). */
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

/** The selection call's messages: the redacted question and the allowed facts only. */
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

/**
 * The selected facts, in the model's order: ids not among the facts it was given
 * (foreign, disallowed or invented) and repeats are dropped. no_relevant_facts,
 * invalid JSON or a wrong shape select nothing.
 */
export function parseSelection(raw: string | null | undefined, facts: readonly SelectableFact[]): Fact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const { fact_ids: ids, no_relevant_facts: noneRelevant } = parsed as Record<string, unknown>;
  if (noneRelevant === true || !Array.isArray(ids)) {
    return [];
  }
  const byPromptId = new Map(facts.map((entry) => [entry.promptId, entry.fact]));
  const selected: Fact[] = [];
  for (const id of ids) {
    const entry = typeof id === "string" ? byPromptId.get(id.trim()) : undefined;
    if (entry && !selected.includes(entry)) {
      selected.push(entry);
    }
  }
  return selected;
}
