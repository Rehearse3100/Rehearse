/**
 * data-room-chat-scope.ts
 * Pure helpers for the Data Room AI Research Assistant (no DB, no network).
 * Works out which companies a question is about: the generic-word list (derived
 * from the roster itself), type-to-pick suggestions, company detection in the
 * question text, and the scope priority used on send. Server side: scope and
 * history parsing, ref labels ([C1]…), name redaction for the prompt, and the
 * guard that rejects company names in model replies. Used by
 * ProspectingDataRoomChat (client) and POST /api/student/data-room-chat (server).
 */

// ── Types and limits ───

export type ScopeCompany = {
  id: string;
  name: string;
  /** Industry label shown on the company card (its words count as generic). */
  industry: string;
};

/** What one question is about: up to 3 companies, or all companies. */
export type ChatScope = { mode: "companies"; companyIds: string[] } | { mode: "all" };

/** Most companies one question may be about (unless All companies is on). */
export const MAX_SCOPE_COMPANIES = 3;
/** Letters typed before suggestions appear. */
export const MIN_SUGGEST_LETTERS = 3;
/** Most suggestions shown at once. */
export const MAX_SUGGESTIONS = 5;
/** A first word must be at least this long to identify a company on its own. */
export const MIN_DETECT_WORD_LETTERS = 4;
/** A word used in this many company names (or more) is generic. */
export const GENERIC_NAME_WORD_MIN_COMPANIES = 3;

/** Words that never identify a company. */
export const STOP_WORDS: readonly string[] = [
  "a",
  "an",
  "and",
  "at",
  "by",
  "co",
  "company",
  "corp",
  "for",
  "in",
  "inc",
  "llc",
  "ltd",
  "of",
  "on",
  "the",
  "to",
];

export const SCOPE_NONE_MESSAGE = "Open a company or type a company's name first.";
export const SCOPE_TOO_MANY_MESSAGE = "Ask about up to 3 companies, or turn on All companies.";

// ── Words and the generic list ───

/**
 * Lowercased words of a name or text (letters and digits; everything else splits).
 */
export function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * Generic words, computed from the roster itself: words used in 3+ company names,
 * every word of every industry label, and stop words. Generic words never suggest,
 * detect, or identify a company.
 */
export function buildGenericWords(companies: readonly ScopeCompany[]): Set<string> {
  const generic = new Set<string>(STOP_WORDS);
  const companiesPerWord = new Map<string, number>();
  for (const company of companies) {
    for (const word of Array.from(new Set(toWords(company.name)))) {
      companiesPerWord.set(word, (companiesPerWord.get(word) ?? 0) + 1);
    }
    for (const word of toWords(company.industry)) {
      generic.add(word);
    }
  }
  companiesPerWord.forEach((count, word) => {
    if (count >= GENERIC_NAME_WORD_MIN_COMPANIES) {
      generic.add(word);
    }
  });
  return generic;
}

export type ScopeIndex = {
  companies: readonly ScopeCompany[];
  byId: ReadonlyMap<string, ScopeCompany>;
  genericWords: ReadonlySet<string>;
  /** Lowercased words of each company name, by company id. */
  nameWordsById: ReadonlyMap<string, string[]>;
  /**
   * Identifying words: each name's first word when it is non-generic and at least
   * MIN_DETECT_WORD_LETTERS long, mapped to the companies whose name starts with it.
   */
  firstWordIds: ReadonlyMap<string, string[]>;
};

/**
 * Builds the lookup tables used for suggestions, detection, and the name guard.
 */
export function buildScopeIndex(companies: readonly ScopeCompany[]): ScopeIndex {
  const genericWords = buildGenericWords(companies);
  const byId = new Map<string, ScopeCompany>();
  const nameWordsById = new Map<string, string[]>();
  const firstWordIds = new Map<string, string[]>();

  for (const company of companies) {
    byId.set(company.id, company);
    const words = toWords(company.name);
    nameWordsById.set(company.id, words);
    const first = words[0];
    if (first && first.length >= MIN_DETECT_WORD_LETTERS && !genericWords.has(first)) {
      firstWordIds.set(first, [...(firstWordIds.get(first) ?? []), company.id]);
    }
  }

  return { companies, byId, genericWords, nameWordsById, firstWordIds };
}

// ── Type-to-pick ───

export type WordFragment = {
  /** The letters typed so far for the current word. */
  fragment: string;
  /** Index in the text where the current word starts. */
  start: number;
};

/**
 * The word being typed: letters/digits immediately before the caret.
 */
export function wordFragmentBeforeCaret(text: string, caret: number): WordFragment | null {
  const end = Math.max(0, Math.min(caret, text.length));
  let start = end;
  while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  const fragment = text.slice(start, end);
  return fragment.length > 0 ? { fragment, start } : null;
}

/**
 * Up to MAX_SUGGESTIONS companies with a non-generic name word starting with the
 * fragment (at least MIN_SUGGEST_LETTERS letters). Companies whose first word
 * matches come first, then alphabetical.
 */
export function suggestCompanies(index: ScopeIndex, fragment: string): ScopeCompany[] {
  const prefix = fragment.toLowerCase();
  if (prefix.length < MIN_SUGGEST_LETTERS || !/^[a-z0-9]+$/.test(prefix)) {
    return [];
  }

  const matches: Array<{ company: ScopeCompany; firstWordMatch: boolean }> = [];
  for (const company of index.companies) {
    const words = index.nameWordsById.get(company.id) ?? [];
    const matching = words.filter(
      (word) => !index.genericWords.has(word) && word.startsWith(prefix)
    );
    if (matching.length > 0) {
      matches.push({ company, firstWordMatch: words[0]?.startsWith(prefix) === true });
    }
  }

  return matches
    .sort((a, b) =>
      a.firstWordMatch !== b.firstWordMatch
        ? a.firstWordMatch
          ? -1
          : 1
        : a.company.name.localeCompare(b.company.name)
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((match) => match.company);
}

/**
 * Replaces the typed fragment (and the rest of that word) with the company name.
 * Adds a trailing space when the name ends the text. Returns the new caret position.
 */
export function insertPickedName(
  text: string,
  start: number,
  caret: number,
  name: string
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const restOfWord = text.slice(caret).match(/^[A-Za-z0-9]*/)?.[0] ?? "";
  const after = text.slice(caret + restOfWord.length);
  const inserted = after.length === 0 ? `${name} ` : name;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

// ── Detection ───

type NameMatch = { companyId: string; startWord: number; endWord: number };

/**
 * Every place a full company name appears in the text (whole words, any case).
 * Longer names are matched first so a full name wins over a shorter one inside it.
 */
function findFullNameMatches(index: ScopeIndex, words: string[]): NameMatch[] {
  const matches: NameMatch[] = [];
  const taken = new Set<number>();
  const byLength = [...index.companies].sort(
    (a, b) =>
      (index.nameWordsById.get(b.id)?.length ?? 0) - (index.nameWordsById.get(a.id)?.length ?? 0)
  );

  for (const company of byLength) {
    const nameWords = index.nameWordsById.get(company.id) ?? [];
    if (nameWords.length === 0) {
      continue;
    }
    for (let i = 0; i + nameWords.length <= words.length; i += 1) {
      const fits = nameWords.every(
        (word, offset) => words[i + offset] === word && !taken.has(i + offset)
      );
      if (fits) {
        for (let k = i; k < i + nameWords.length; k += 1) {
          taken.add(k);
        }
        matches.push({ companyId: company.id, startWord: i, endWord: i + nameWords.length });
      }
    }
  }
  return matches;
}

/**
 * True when the company's full name appears in the text.
 */
export function textContainsCompanyName(index: ScopeIndex, text: string, companyId: string): boolean {
  return findFullNameMatches(index, toWords(text)).some((match) => match.companyId === companyId);
}

export type CompanyDetection = {
  /** Detected companies, in the order they appear in the text. */
  companyIds: string[];
  /** A first word shared by 2+ companies that none of the known ids resolves. */
  ambiguous: { word: string; options: ScopeCompany[] } | null;
};

/**
 * Companies named in the text: a full name, or an identifying first word that
 * belongs to exactly one company. A first word shared by 2+ companies is
 * ambiguous unless one of them is already known (picked or named in full).
 */
export function detectCompanies(
  index: ScopeIndex,
  text: string,
  knownIds: readonly string[] = []
): CompanyDetection {
  const words = toWords(text);
  const fullMatches = findFullNameMatches(index, words);
  const covered = new Set<number>();
  const positions = new Map<string, number>();

  for (const match of fullMatches) {
    for (let k = match.startWord; k < match.endWord; k += 1) {
      covered.add(k);
    }
    if (!positions.has(match.companyId)) {
      positions.set(match.companyId, match.startWord);
    }
  }

  const resolved = new Set<string>([...knownIds, ...Array.from(positions.keys())]);
  let ambiguous: CompanyDetection["ambiguous"] = null;

  words.forEach((word, i) => {
    if (covered.has(i)) {
      return;
    }
    const ids = index.firstWordIds.get(word);
    if (!ids) {
      return;
    }
    if (ids.length === 1) {
      const [only] = ids;
      if (only && !positions.has(only)) {
        positions.set(only, i);
      }
      return;
    }
    if (!ids.some((id) => resolved.has(id)) && ambiguous === null) {
      ambiguous = {
        word,
        options: ids
          .map((id) => index.byId.get(id))
          .filter((company): company is ScopeCompany => Boolean(company)),
      };
    }
  });

  const companyIds = Array.from(positions.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  return { companyIds, ambiguous };
}

/** Out-of-scope companies a question mentions (see findOutOfScopeMentions). */
export type OutOfScopeMention = {
  companies: ScopeCompany[];
  /** True for one first word shared by 2+ companies: they are alternatives ("A or B"). */
  isEitherOr: boolean;
};

/**
 * Companies the text mentions that are NOT in scope, using the same detection as
 * the redaction (full names, and identifying first words; generic words never
 * count). A first word shared by an in-scope company counts as in scope. Null
 * when the text mentions no out-of-scope company.
 */
export function findOutOfScopeMentions(
  index: ScopeIndex,
  text: string,
  scopeIds: readonly string[]
): OutOfScopeMention | null {
  const inScope = new Set(scopeIds);
  const detection = detectCompanies(index, text, scopeIds);
  const companies = detection.companyIds
    .filter((id) => !inScope.has(id))
    .map((id) => index.byId.get(id))
    .filter((company): company is ScopeCompany => Boolean(company));
  if (companies.length > 0) {
    return { companies, isEitherOr: false };
  }
  return detection.ambiguous ? { companies: detection.ambiguous.options, isEitherOr: true } : null;
}

function joinNames(names: readonly string[], conjunction: "and" | "or"): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

/**
 * The fixed reply for a question that mentions an unselected company (names come
 * from the roster): "Your question mentions {Name}, which isn't selected. …"
 */
export function buildOutOfScopeMessage(mention: OutOfScopeMention): string {
  const names = mention.companies.map((company) => company.name);
  if (names.length > 1 && !mention.isEitherOr) {
    return `Your question mentions ${joinNames(names, "and")}, which aren't selected. Type their names and press Enter, or open them from the list, and I'll answer about them.`;
  }
  return `Your question mentions ${joinNames(names, "or")}, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it.`;
}

// ── Scope on send ───

/** The previous question: its scope, and the company that was open when it was sent. */
export type LastQuestion = {
  scope: ChatScope;
  openCompanyId: string | null;
};

export type ScopeInput = {
  index: ScopeIndex;
  text: string;
  allCompanies: boolean;
  /** Companies picked from suggestions (or from "Which one did you mean?"). */
  pickedIds: readonly string[];
  openCompanyId: string | null;
  /** The previous question, for follow-ups that name no company (null or omitted: none). */
  lastQuestion?: LastQuestion | null;
};

export type ScopeDecision =
  | { kind: "send"; scope: ChatScope }
  | { kind: "ask"; word: string; options: ScopeCompany[] }
  | { kind: "error"; message: string };

/**
 * Follow-up scope: the previous question's 1–3 companies, as long as the student
 * hasn't opened a different company since it was sent (the open company then is
 * compared with the open company now). Null when it doesn't apply, including when
 * the previous question was about All companies.
 */
function followUpScopeIds(input: ScopeInput): string[] | null {
  const last = input.lastQuestion;
  if (!last || last.scope.mode !== "companies" || last.openCompanyId !== input.openCompanyId) {
    return null;
  }
  const ids = last.scope.companyIds.filter((id) => input.index.byId.has(id));
  return ids.length > 0 ? ids : null;
}

/**
 * Scope for sending, in priority order: (1) All companies; (2) picked companies
 * plus companies named in the text (an ambiguous first word asks instead, and
 * more than 3 is an error); (3) the previous question's companies, unless a
 * different company was opened since; (4) the open company; (5) nothing → error.
 */
export function resolveSendScope(input: ScopeInput): ScopeDecision {
  if (input.allCompanies) {
    return { kind: "send", scope: { mode: "all" } };
  }

  const picked = input.pickedIds.filter((id) => input.index.byId.has(id));
  const detection = detectCompanies(input.index, input.text, picked);
  if (detection.ambiguous) {
    return { kind: "ask", word: detection.ambiguous.word, options: detection.ambiguous.options };
  }

  const ids = Array.from(new Set([...picked, ...detection.companyIds]));
  if (ids.length > MAX_SCOPE_COMPANIES) {
    return { kind: "error", message: SCOPE_TOO_MANY_MESSAGE };
  }
  if (ids.length > 0) {
    return { kind: "send", scope: { mode: "companies", companyIds: ids } };
  }
  const followUp = followUpScopeIds(input);
  if (followUp) {
    return { kind: "send", scope: { mode: "companies", companyIds: followUp } };
  }
  if (input.openCompanyId && input.index.byId.has(input.openCompanyId)) {
    return { kind: "send", scope: { mode: "companies", companyIds: [input.openCompanyId] } };
  }
  return { kind: "error", message: SCOPE_NONE_MESSAGE };
}

export type ScopePreview =
  | { kind: "all" }
  | { kind: "companies"; companies: ScopeCompany[] }
  | { kind: "none" };

/**
 * Live scope for the "Current:" line: the same priority as resolveSendScope
 * (including follow-ups), but an ambiguous word or too many companies never
 * blocks the preview.
 */
export function previewScope(input: ScopeInput): ScopePreview {
  if (input.allCompanies) {
    return { kind: "all" };
  }
  const picked = input.pickedIds.filter((id) => input.index.byId.has(id));
  const detected = detectCompanies(input.index, input.text, picked).companyIds;
  const ids = Array.from(new Set([...picked, ...detected]));
  const openCompanyIds =
    input.openCompanyId && input.index.byId.has(input.openCompanyId) ? [input.openCompanyId] : [];
  const fallback = ids.length > 0 ? ids : followUpScopeIds(input) ?? openCompanyIds;
  const companies = fallback
    .map((id) => input.index.byId.get(id))
    .filter((company): company is ScopeCompany => Boolean(company));
  return companies.length > 0 ? { kind: "companies", companies } : { kind: "none" };
}

/**
 * True when two scopes cover exactly the same companies (order ignored).
 */
export function scopesEqual(a: ChatScope, b: ChatScope): boolean {
  if (a.mode !== b.mode) {
    return false;
  }
  if (a.mode === "all" || b.mode === "all") {
    return true;
  }
  const left = new Set(a.companyIds);
  return left.size === new Set(b.companyIds).size && b.companyIds.every((id) => left.has(id));
}

// ── Server: request parsing ───

/** Most recent messages (any scope) considered as context for the model. */
export const HISTORY_TURN_LIMIT = 10;
const MAX_HISTORY_ENTRIES = 100;
const MAX_TEXT_LENGTH = 8_000;

/**
 * Parses a request scope: { mode: "all" } or { mode: "companies", companyIds }
 * with 1–3 distinct non-empty ids. Anything else is null.
 */
export function parseChatScope(raw: unknown): ChatScope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { mode, companyIds } = raw as { mode?: unknown; companyIds?: unknown };
  if (mode === "all") {
    return { mode: "all" };
  }
  if (mode !== "companies" || !Array.isArray(companyIds)) {
    return null;
  }
  const ids: string[] = [];
  for (const value of companyIds) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    const id = value.trim();
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.length >= 1 && ids.length <= MAX_SCOPE_COMPANIES
    ? { mode: "companies", companyIds: ids }
    : null;
}

export type HistoryEntry =
  | { role: "user"; content: string; scope: ChatScope }
  | {
      role: "assistant";
      intro: string;
      items: Array<{ companyId: string; text: string }>;
      scope: ChatScope;
    };

/**
 * Parses client-sent history: ids, text and scope only (company names are never
 * read). Malformed entries are dropped.
 */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.slice(-MAX_HISTORY_ENTRIES).flatMap((entry): HistoryEntry[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const scope = parseChatScope(record.scope);
    if (!scope) {
      return [];
    }
    if (record.role === "user" && typeof record.content === "string") {
      return [{ role: "user", content: record.content.slice(0, MAX_TEXT_LENGTH), scope }];
    }
    if (record.role === "assistant" && Array.isArray(record.items)) {
      const items = record.items.flatMap((item): Array<{ companyId: string; text: string }> => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const { companyId, text } = item as Record<string, unknown>;
        return typeof companyId === "string" && typeof text === "string"
          ? [{ companyId, text: text.slice(0, MAX_TEXT_LENGTH) }]
          : [];
      });
      const intro = typeof record.intro === "string" ? record.intro.slice(0, MAX_TEXT_LENGTH) : "";
      return [{ role: "assistant", intro, items, scope }];
    }
    return [];
  });
}

/**
 * History for the model: the last 10 messages regardless of scope. Messages whose
 * scope exactly matches the current scope are kept whole (questions and answers);
 * from any other scope only the student's questions are kept and the answers are
 * dropped, so no other company's facts reach this answer. The route redacts names
 * in every kept question (companies outside the scope become "another company").
 */
export function selectHistoryForScope(history: HistoryEntry[], scope: ChatScope): HistoryEntry[] {
  return history
    .slice(-HISTORY_TURN_LIMIT)
    .filter((entry) => entry.role === "user" || scopesEqual(entry.scope, scope));
}

/**
 * Ref labels for the companies in scope, in order: id → "C1", "C2", ….
 */
export function buildRefLabels(companyIds: readonly string[]): Map<string, string> {
  return new Map(companyIds.map((id, i) => [id, `C${i + 1}`]));
}

// ── Server: name redaction and the guard ───

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word pattern for a name's words, any separators between them. */
function wordsPattern(words: readonly string[]): string {
  return `(?<![A-Za-z0-9])${words.map(escapeRegExp).join("[^A-Za-z0-9]+")}(?![A-Za-z0-9])`;
}

/** The first word of a name exactly as written (for case-sensitive redaction). */
export function firstWordAsWritten(name: string): string {
  return name.trim().match(/^[A-Za-z0-9]+/)?.[0] ?? "";
}

export type FirstWordReplacement = {
  word: string;
  replacement: string;
  caseSensitive: boolean;
};

/**
 * Replaces every full company name (any case, whole words; longest first) with
 * fullNameReplacement(companyId), then each listed first word with its replacement.
 */
export function redactCompanyMentions(
  text: string,
  index: ScopeIndex,
  fullNameReplacement: (companyId: string) => string,
  firstWords: readonly FirstWordReplacement[] = []
): string {
  let out = text;
  const byLength = [...index.companies].sort(
    (a, b) =>
      (index.nameWordsById.get(b.id)?.length ?? 0) - (index.nameWordsById.get(a.id)?.length ?? 0)
  );
  for (const company of byLength) {
    const words = index.nameWordsById.get(company.id) ?? [];
    if (words.length > 0) {
      out = out.replace(new RegExp(wordsPattern(words), "gi"), fullNameReplacement(company.id));
    }
  }
  for (const entry of firstWords) {
    if (entry.word.length > 0) {
      out = out.replace(
        new RegExp(wordsPattern([entry.word]), entry.caseSensitive ? "g" : "gi"),
        entry.replacement
      );
    }
  }
  return out;
}

/**
 * Company names found in a text: any full roster name, or any identifying first
 * word (non-generic, 4+ letters). Empty when the text is clean.
 */
export function findCompanyNameMentions(text: string, index: ScopeIndex): string[] {
  const words = toWords(text);
  const fullMatches = findFullNameMatches(index, words);
  const covered = new Set<number>();
  const hits = new Set<string>();
  for (const match of fullMatches) {
    hits.add(index.byId.get(match.companyId)?.name ?? match.companyId);
    for (let k = match.startWord; k < match.endWord; k += 1) {
      covered.add(k);
    }
  }
  words.forEach((word, i) => {
    if (!covered.has(i) && index.firstWordIds.has(word)) {
      hits.add(word);
    }
  });
  return Array.from(hits);
}

// ── Server: model reply ───

export type ModelAnswer = {
  intro: string;
  items: Array<{ ref: string; text: string }>;
};

export type ScopedAnswer = {
  intro: string;
  items: Array<{ companyId: string; companyName: string; text: string }>;
};

/**
 * Parses the model's JSON reply: {"intro": string, "items": [{"ref", "text"}]}.
 * Returns null for anything that does not have that shape.
 */
export function parseModelAnswer(raw: string | null | undefined): ModelAnswer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const { intro, items } = parsed as { intro?: unknown; items?: unknown };
  if ((intro !== undefined && intro !== null && typeof intro !== "string") || !Array.isArray(items)) {
    return null;
  }
  const parsedItems: ModelAnswer["items"] = [];
  for (const item of items) {
    const { ref, text } = (item ?? {}) as { ref?: unknown; text?: unknown };
    if (typeof ref !== "string" || typeof text !== "string") {
      return null;
    }
    parsedItems.push({ ref, text });
  }
  return { intro: typeof intro === "string" ? intro : "", items: parsedItems };
}

/** Removes ref labels the model may have written inside a text. */
function stripRefLabels(text: string): string {
  return text.replace(/\[C\d+\]|\bC\d+\b/g, "the company");
}

/**
 * Maps refs back to companies (names from the roster, never from the model),
 * drops refs that are not in scope, then rejects the answer (null) if the intro
 * or any text names a company.
 */
export function finalizeModelAnswer(
  answer: ModelAnswer,
  refLabels: ReadonlyMap<string, string>,
  index: ScopeIndex
): ScopedAnswer | null {
  const idByRef = new Map(Array.from(refLabels.entries()).map(([id, ref]) => [ref, id]));
  const seen = new Set<string>();
  const items: ScopedAnswer["items"] = [];

  for (const item of answer.items) {
    const ref = item.ref.trim().replace(/^\[|\]$/g, "").toUpperCase();
    const companyId = idByRef.get(ref);
    const company = companyId ? index.byId.get(companyId) : undefined;
    const text = stripRefLabels(item.text).trim();
    if (!companyId || !company || seen.has(companyId) || text.length === 0) {
      continue;
    }
    seen.add(companyId);
    items.push({ companyId, companyName: company.name, text });
  }

  const intro = stripRefLabels(answer.intro).trim();
  const leaked = [intro, ...items.map((item) => item.text)].some(
    (text) => findCompanyNameMentions(text, index).length > 0
  );
  return leaked ? null : { intro, items };
}

/**
 * True when a finalized answer says nothing: no items and a blank intro, or the
 * model wrote items but every one was dropped (ref not in scope, duplicate, or
 * empty text), which leaves at most an intro that introduces nothing.
 */
export function isEmptyModelAnswer(parsed: ModelAnswer, finalized: ScopedAnswer): boolean {
  return finalized.items.length === 0 && (finalized.intro.length === 0 || parsed.items.length > 0);
}
