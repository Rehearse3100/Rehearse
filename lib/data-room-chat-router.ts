/**
 * data-room-chat-router.ts
 * Question router for the Data Room assistant (pure). Builds the classifier call's
 * messages: the student's question, their last 3 questions (both already
 * name-redacted) and the scope kind — never any facts or company data — and parses
 * its JSON reply, failing closed to "overview". For All-companies filter questions
 * the reply also carries the filters (as many as the question asks for) and how many
 * conditions the question asks for (a locations range is one; validated by
 * lib/data-room-chat-filter.ts); in All companies mode valid
 * filters are used even when the router is unsure. The reply also says whether the
 * question is in English (parseRouterEnglish; a message with two common English
 * function words counts as English whatever it says, hasEnglishFunctionWords) and, for
 * a list, the order it asks for (sort: locations or name). "Compare …", "side by
 * side" and "vs" are read in code (isCompareRequest). Follow-ups ("tell me more", "more
 * about that") about the same 1–3 companies are recognised in code
 * (isFollowUpQuestion) and routed as the earlier question they follow
 * (parseFollowUpContext reads it, and the lines its answer showed, from the
 * client-sent history). POST /api/student/data-room-chat
 * makes the gpt-4o call; lib/data-room-chat-policy.ts turns the decision into the
 * allowed facts and lib/data-room-chat-render.ts into the answer path.
 */

import { getDataRoomChatConfig, type DataRoomChatConfig } from "@/lib/data-room-chat-config";
import { parseRosterFilters, parseRosterSort, type RosterFilter, type RosterSort } from "@/lib/data-room-chat-filter";
import { QUESTION_TOPICS, type QuestionTopic } from "@/lib/data-room-research-topics";
import { parseChatScope, type ChatScope } from "@/lib/data-room-chat-scope";

// ── Decision shape ───

export const ROUTER_INTENTS = [
  "overview",
  "attribute_lookup",
  "specific_research",
  "compare",
  "filter_list",
  "meta_or_bulk",
  "off_topic",
  "inappropriate",
] as const;

export type RouterIntent = (typeof ROUTER_INTENTS)[number];

export const ROUTER_ATTRIBUTES = [
  "industry",
  "locations",
  "metro",
  "territory",
  "online_booking",
  "size",
  "contacts",
] as const;

export type RouterAttribute = (typeof ROUTER_ATTRIBUTES)[number];

export type RouterDecision = {
  intent: RouterIntent;
  topic: QuestionTopic | null;
  attribute: RouterAttribute | null;
  /** The whitelisted conditions (All-companies filter questions only; no limit); null when missing or any is invalid. */
  filters: RosterFilter[] | null;
  /** How many conditions the question filters by; null when missing or invalid. */
  criteriaCount: number | null;
  /** The question asks for one specific detail (a number, amount, count, email or phone, a named vendor or product). */
  exactValue: boolean;
  /** The order a list question asks for (by locations or name); omitted when it asks for none (A–Z). */
  sort?: RosterSort;
};

/** What every unclear or invalid classification becomes: public facts only. */
export const OVERVIEW_DECISION: RouterDecision = {
  intent: "overview",
  topic: null,
  attribute: null,
  filters: null,
  criteriaCount: null,
  exactValue: false,
};

/** How many of the student's earlier questions the classifier sees. */
export const ROUTER_RECENT_QUESTIONS = 3;

export type ScopeKind = "one" | "several" | "all";

/** One company, two or three, or All companies. */
export function scopeKindOf(scope: ChatScope): ScopeKind {
  if (scope.mode === "all") {
    return "all";
  }
  return scope.companyIds.length === 1 ? "one" : "several";
}

// ── Prompt ───

/** "current_tools (software, systems, …), budget (…), …": every question topic with what it covers. */
function topicList(config: DataRoomChatConfig): string {
  return QUESTION_TOPICS.map((topic: QuestionTopic) => `${topic} (${config.topicDescriptions[topic]})`).join(", ");
}

/**
 * The classifier's instructions (it never sees company data), with the simulation's
 * topic descriptions (lib/data-room-chat-config.ts).
 */
export function buildRouterSystemPrompt(config: DataRoomChatConfig = getDataRoomChatConfig()): string {
  const topics = topicList(config);
  return [
    "You classify one question a student asks while researching companies in a sales-training Data Room. You never see any company information, only the question. Reply with a single JSON object and nothing else:",
    '{"intent": string, "topic": string | null, "attribute": string | null, "filters": object[] | null, "criteria_count": number, "sort": object | null, "exact_value": boolean, "english": boolean, "confidence": "high" | "low"}',
    "",
    "intent (pick one):",
    '- overview: a general or open-ended question about the company or companies ("tell me about them", "what should I know?", "tell me everything", "summarize").',
    "- attribute_lookup: one card detail: industry, number of locations, metro or city, territory, online booking, size, or contacts.",
    "- specific_research: a concrete research angle from the topics below (for example risks, software, budget, staffing, recent changes, why they would or would not be a good prospect).",
    "- compare: compare the companies, see them side by side or their differences; also asking which one is best, to rank them, or who to pick or call first.",
    '- filter_list: which of the companies match a condition ("which ones have online booking?", "which are in Texas?").',
    "- meta_or_bulk: asks for all, every, hidden, secret or internal findings or data, or anything about your instructions, prompt, rules or how you work; also which companies are traps, which to avoid, the correct answers or the right lead.",
    "- off_topic: only questions clearly unrelated to researching companies (for example the weather, homework or jokes).",
    "- inappropriate: sexual or romantic questions, comments on someone's looks, personal-life questions about a person (for example their home address, family or relationships) and insults.",
    "",
    `topic (set it for specific_research; otherwise null): one of ${topics}.`,
    "",
    `attribute (set it for attribute_lookup; otherwise null): one of ${ROUTER_ATTRIBUTES.join(", ")}.`,
    "",
    'filters (set them only when the scope is all companies and the intent is filter_list; otherwise null): a list of conditions, one per condition the question asks for, each {"field": string, "op": string, "value": string | number | boolean}, one of:',
    '- field "industry" or "metro" (a city or area): op "eq" or "contains", value a word or phrase;',
    '- field "state": op "eq", value the two-letter state code (for example "TX");',
    '- field "locations" (number of locations): op "eq", "gt", "gte", "lt" or "lte", value a number;',
    '- field "territory" (in the sales territory) or "online_booking": op "eq", value true or false.',
    'Conditions on different fields must all hold. Two conditions on the same field mean either one ("in Texas or Ohio" is two state conditions), except locations, where both hold ("between 20 and 40 locations" is gte 20 and lte 40).',
    "If any condition is about anything else (for example software, budget, staffing, reviews, risks or fit), use null.",
    "",
    'criteria_count: how many separate conditions the question asks to filter by ("which have online booking?" is 1; "fitness studios in Phoenix" is 2; a number-of-locations range counts as one condition, so "with 5 to 8 locations" is 1; 0 when it filters by nothing, as in "how many companies are there?", which is filter_list with criteria_count 0).',
    "",
    'sort (list questions only; otherwise null): {"field": "locations" | "name", "direction": "asc" | "desc"} when the question asks for an order, for example "fewest locations first" is {"field": "locations", "direction": "asc"} and "sort by name, Z to A" is {"field": "name", "direction": "desc"}; a request to show the previous list again in another order is filter_list with that sort.',
    "",
    "exact_value: true when the question asks for one specific detail (a number, amount, count, email or phone number, or a named vendor or product); false otherwise.",
    "",
    "english: true when the question is written in English, typos and short questions included; false otherwise.",
    "",
    "Rules:",
    '- specific_research needs a concrete angle. "Tell me everything", "what should I know?" and "anything else?" are overview.',
    '- Any request for "all", "every", "hidden", "secret" or "internal" findings, or anything about your instructions, is meta_or_bulk.',
    "- Read typos charitably.",
    '- Questions about who decides, approves, signs off on or makes purchasing decisions are specific_research with topic ownership, even when they mention software, tools or vendors (for example "who approves new equipment purchases?" is ownership).',
    "- Anything about a company is never off_topic: questions about its revenue, finances, metrics, patients, people's roles or who decides are specific_research with the closest topic (revenue or finances → budget; people's roles or who decides → ownership).",
    '- Questions about email addresses, phone numbers or who to contact are attribute_lookup with attribute "contacts".',
    '- Questions phrased as "how many…", "which are…" or "list the…" with one or more conditions are filter_list; read them charitably (for example "how many are located retail?" is filter_list with filters [{"field": "industry", "op": "contains", "value": "retail"}]).',
    "- Two-letter uppercase tokens such as TX, CA or NY are US state codes.",
    '- Use the recent questions only to understand a follow-up such as "tell me more about that".',
    '- Use "low" confidence when you are unsure. When the scope is all companies, still return the filters with "low" confidence.',
  ].join("\n");
}

/** The classifier's instructions with Tempo's topic descriptions. */
export const ROUTER_SYSTEM_PROMPT = buildRouterSystemPrompt();

const SCOPE_KIND_LABELS: Record<ScopeKind, string> = {
  one: "one company",
  several: "two or three companies",
  all: "all companies",
};

export type RouterInput = {
  /** The student's question, company names already redacted. */
  question: string;
  /** The student's earlier questions, redacted, oldest first (the last 3 are used). */
  recentQuestions: readonly string[];
  scopeKind: ScopeKind;
};

/** The classifier's messages: only the question, recent questions and scope kind. */
export function buildRouterMessages(
  input: RouterInput,
  config: DataRoomChatConfig = getDataRoomChatConfig()
): Array<{ role: "system" | "user"; content: string }> {
  const recent = input.recentQuestions.slice(-ROUTER_RECENT_QUESTIONS);
  return [
    { role: "system", content: buildRouterSystemPrompt(config) },
    {
      role: "user",
      content: [
        `Scope: ${SCOPE_KIND_LABELS[input.scopeKind]}`,
        "Recent questions (oldest first):",
        ...(recent.length > 0 ? recent.map((question) => `- ${question}`) : ["(none)"]),
        `Question: ${input.question}`,
      ].join("\n"),
    },
  ];
}

// ── Reply ───

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * Parses the classifier's reply, failing closed to OVERVIEW_DECISION on invalid
 * JSON, unknown values, low or missing confidence, or specific_research without a
 * topic. With scopeKind "all", a filter_list reply with valid filters is kept
 * whatever its confidence (code checks every condition). For filter_list an unknown
 * topic or attribute just becomes null. Filters come from "filters" (or a single
 * "filter", read as a one-item list; no limit on how many); any condition the
 * whitelist can't read makes them null (an All-companies question then gets the
 * fixed reply); a criteria count that isn't a whole number of 0 or more (as a number or
 * numeric string) becomes null. exact_value is true only when it is exactly true. A
 * valid "sort" (locations or name, asc or desc; parseRosterSort) is kept as sort;
 * anything else leaves it out (A–Z).
 */
export function parseRouterReply(raw: string | null | undefined, scopeKind?: ScopeKind): RouterDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return OVERVIEW_DECISION;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return OVERVIEW_DECISION;
  }
  const {
    intent,
    topic,
    attribute,
    filters: rawFilters,
    filter: rawFilter,
    criteria_count: criteriaCount,
    sort: rawSort,
    exact_value: exactValue,
    confidence,
  } = parsed as Record<string, unknown>;
  const filters = parseRosterFilters(rawFilters, rawFilter);
  const sort = parseRosterSort(rawSort);
  // All companies only: valid filters (or a valid sort) are used even when the router is unsure.
  const isTrusted =
    confidence === "high" || (scopeKind === "all" && intent === "filter_list" && (filters !== null || sort !== null));
  // filter_list never uses topic or attribute, so a stray value there doesn't sink the filters.
  const isStrict = intent !== "filter_list";
  if (
    !isOneOf(ROUTER_INTENTS, intent) ||
    !isTrusted ||
    (isStrict && topic !== null && topic !== undefined && !isOneOf(QUESTION_TOPICS, topic)) ||
    (isStrict && attribute !== null && attribute !== undefined && !isOneOf(ROUTER_ATTRIBUTES, attribute))
  ) {
    return OVERVIEW_DECISION;
  }
  const count = typeof criteriaCount === "string" && criteriaCount.trim() !== "" ? Number(criteriaCount) : criteriaCount;
  const decision: RouterDecision = {
    intent,
    topic: isOneOf(QUESTION_TOPICS, topic) ? topic : null,
    attribute: isOneOf(ROUTER_ATTRIBUTES, attribute) ? attribute : null,
    filters,
    criteriaCount: Number.isInteger(count) && (count as number) >= 0 ? (count as number) : null,
    exactValue: exactValue === true,
    ...(sort ? { sort } : {}),
  };
  return decision.intent === "specific_research" && decision.topic === null
    ? OVERVIEW_DECISION
    : decision;
}

/**
 * Whether the router reply says the question is in English: false only for
 * "english": false with "high" confidence; anything missing or invalid (or a
 * reply that isn't JSON) counts as English.
 */
export function parseRouterEnglish(raw: string | null | undefined): boolean {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return true;
    }
    const { english, confidence } = parsed as Record<string, unknown>;
    return !(english === false && confidence === "high");
  } catch {
    return true;
  }
}

// ── English, read from the words ───

/** Common English function words: two different ones in a message make it English, typos and all. */
const ENGLISH_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "the", "for", "only", "and", "of", "to", "in", "with", "on", "at", "by", "from", "or", "than",
  "what", "which", "who", "where", "when", "why", "how",
  "do", "does", "is", "are", "was", "were", "be", "have", "has", "can",
  "they", "them", "their", "it", "its", "me", "you", "this", "that", "these", "those", "there",
  "about", "any",
]);

/** How many different English function words make a message English whatever the router says. */
export const MIN_ENGLISH_FUNCTION_WORDS = 2;

/**
 * True when the message holds at least two different common English function words
 * ("comoare the 3 only for locations": the, only, for). A typo-heavy English question
 * then never gets "Please ask in English." because the router misread it. The
 * non-Latin script check runs before this and is unchanged.
 */
export function hasEnglishFunctionWords(text: string): boolean {
  const words = new Set(text.toLowerCase().replace(/['’]/g, "").split(/[^a-z]+/).filter((word) => word.length > 0));
  let found = 0;
  words.forEach((word) => {
    if (ENGLISH_FUNCTION_WORDS.has(word)) {
      found += 1;
    }
  });
  return found >= MIN_ENGLISH_FUNCTION_WORDS;
}

// ── Compare, read from the words ───

/** True when the two words differ by at most one letter added, dropped, changed or swapped with its neighbour. */
function isOneEditAway(word: string, target: string): boolean {
  if (word === target) {
    return true;
  }
  if (Math.abs(word.length - target.length) > 1) {
    return false;
  }
  if (word.length === target.length) {
    const diffs: number[] = [];
    for (let i = 0; i < word.length; i += 1) {
      if (word[i] !== target[i]) {
        diffs.push(i);
      }
    }
    if (diffs.length === 1) {
      return true;
    }
    const [first, second] = diffs;
    return (
      diffs.length === 2 &&
      first !== undefined &&
      second === first + 1 &&
      word[first] === target[second] &&
      word[second] === target[first]
    );
  }
  const [shorter, longer] = word.length < target.length ? [word, target] : [target, word];
  for (let i = 0; i < longer.length; i += 1) {
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) {
      return true;
    }
  }
  return false;
}

/** Words of at least this length are checked against "compare" for a one-letter typo ("comoare"). */
const MIN_COMPARE_TYPO_LETTERS = 6;

/**
 * True when the question asks to compare: "compare", "compared", "comparison"…
 * (also with a one-letter typo such as "comoare"), "vs" / "versus", or "side by
 * side". The route sends such a question about 2–3 companies down the compare path.
 */
export function isCompareRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\bside[\s-]+by[\s-]+side\b/.test(lower)) {
    return true;
  }
  return lower
    .split(/[^a-z]+/)
    .some(
      (word) =>
        word === "vs" ||
        word === "versus" ||
        word.startsWith("compar") ||
        (word.length >= MIN_COMPARE_TYPO_LETTERS && isOneEditAway(word, "compare"))
    );
}

// ── "Which ones…" about one company ───

/** A question that starts "which ones", "which of them" or "which companies" (any case, leading punctuation ignored). */
const WHICH_ONES_QUESTION = /^[^a-z0-9]*which\s+(?:ones|of\s+them|companies)\b/i;

/**
 * True when the question starts "which ones", "which of them" or "which companies":
 * with one company open it reads as a question about many, so the pane offers
 * "Search all companies" whatever the router labelled it.
 */
export function isWhichOnesQuestion(text: string): boolean {
  return WHICH_ONES_QUESTION.test(text);
}

// ── Follow-ups ───

/** A follow-up refers back with one of these (never "them": that is the companies themselves). */
const BACK_REFERENCE = "(?:that|this|it|those|these)";

/**
 * Whole-message follow-up phrasings, after lowercasing, dropping punctuation, a
 * lead-in ("ok", "can you"…) and a closing "please".
 */
const FOLLOW_UP_PATTERNS: readonly RegExp[] = [
  new RegExp(`^(?:(?:tell|show|give) me|say|share) (?:a (?:bit|little) )?more(?: (?:about|on) ${BACK_REFERENCE})?$`),
  new RegExp(`^more(?: details?| info| information)?(?: (?:about|on) ${BACK_REFERENCE})?$`),
  new RegExp(`^(?:anything|something|what) (?:else|more) (?:about|on) ${BACK_REFERENCE}$`),
  new RegExp(`^(?:go on|keep going|elaborate(?: on ${BACK_REFERENCE})?|expand on ${BACK_REFERENCE})$`),
];
const FOLLOW_UP_LEAD_IN =
  /^(?:(?:ok|okay|cool|great|nice|thanks|thank you|and|so|sure|yes|yeah|please|can you|could you|would you)\s+)+/;
const FOLLOW_UP_CLOSING = /\s+please$/;

/** The same caps parseHistoryQuestions uses for client-sent history. */
const FOLLOW_UP_MAX_HISTORY_ENTRIES = 100;
const FOLLOW_UP_MAX_TEXT_LENGTH = 8_000;

/**
 * True when the whole message only asks for more on the previous answer ("tell me
 * more", "more about that", "anything else on that?", "can you elaborate?"). A
 * message with its own subject ("tell me more about their budget") or about the
 * companies themselves ("tell me more about them") is not a follow-up.
 */
export function isFollowUpQuestion(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(FOLLOW_UP_LEAD_IN, "")
    .replace(FOLLOW_UP_CLOSING, "")
    .trim();
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** What a follow-up is about, read from the client-sent history. */
export type FollowUpContext = {
  /** The latest earlier question that isn't itself a follow-up: the follow-up is routed and answered as this. */
  question: string;
  /** The questions before it, oldest first (the router's recent questions). */
  earlierQuestions: string[];
  /** The lines the latest answer already showed, by company id (empty when there is none). */
  shownLines: Map<string, Set<string>>;
};

type HistoryTurn = { question: string; scope: ChatScope | null; lines: Map<string, Set<string>> | null };

function isSameCompanies(a: ChatScope | null, b: ChatScope): boolean {
  if (a?.mode !== "companies" || b.mode !== "companies" || a.companyIds.length !== b.companyIds.length) {
    return false;
  }
  return a.companyIds.every((id) => b.companyIds.includes(id));
}

/** An answer's lines by company id, from its items ({ companyId, text }; malformed items are skipped). */
function parseShownLines(items: unknown[]): Map<string, Set<string>> {
  const lines = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const { companyId, text } = item as Record<string, unknown>;
    if (typeof companyId !== "string" || typeof text !== "string") {
      continue;
    }
    const set = lines.get(companyId) ?? new Set<string>();
    for (const line of text.split("\n")) {
      if (line.trim()) {
        set.add(line.trim());
      }
    }
    lines.set(companyId, set);
  }
  return lines;
}

/**
 * The context of a follow-up about the given 1–3 companies, from the client-sent
 * history ({ role: "user", content, scope } and { role: "assistant", items, scope }).
 * Walks back from the latest question over earlier follow-ups to the question they
 * follow; every question on the way must be about the same companies. Null when
 * there is no such question, a question on the way is about other companies (or
 * has no scope), or the scope is All companies. The history is client-sent: it only
 * picks the question to route and the lines to compare, never text that is shown.
 */
export function parseFollowUpContext(history: unknown, scope: ChatScope): FollowUpContext | null {
  if (!Array.isArray(history) || scope.mode !== "companies") {
    return null;
  }
  const turns: HistoryTurn[] = [];
  for (const entry of history.slice(-FOLLOW_UP_MAX_HISTORY_ENTRIES)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { role, content, scope: entryScope, items } = entry as Record<string, unknown>;
    if (role === "user" && typeof content === "string") {
      turns.push({ question: content.slice(0, FOLLOW_UP_MAX_TEXT_LENGTH), scope: parseChatScope(entryScope), lines: null });
    } else if (role === "assistant" && Array.isArray(items) && turns.length > 0) {
      const turn = turns[turns.length - 1];
      if (turn) {
        turn.lines = parseShownLines(items);
      }
    }
  }
  let latestLines: Map<string, Set<string>> | null = null;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (!turn || !isSameCompanies(turn.scope, scope)) {
      return null;
    }
    latestLines = latestLines ?? turn.lines;
    if (!isFollowUpQuestion(turn.question)) {
      return {
        question: turn.question,
        earlierQuestions: turns.slice(0, i).map((earlier) => earlier.question),
        shownLines: latestLines ?? new Map<string, Set<string>>(),
      };
    }
  }
  return null;
}
