/**
 * data-room-chat-scope.ts
 * Pure helpers for the Data Room AI Research Assistant (no DB, no network).
 * Works out which companies a question is about: the generic-word list (derived
 * from the roster itself), type-to-pick suggestions, company detection in the
 * question text, and the scope priority used on send. Used by
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

// ── Scope on send ───

export type ScopeInput = {
  index: ScopeIndex;
  text: string;
  allCompanies: boolean;
  /** Companies picked from suggestions (or from "Which one did you mean?"). */
  pickedIds: readonly string[];
  openCompanyId: string | null;
};

export type ScopeDecision =
  | { kind: "send"; scope: ChatScope }
  | { kind: "ask"; word: string; options: ScopeCompany[] }
  | { kind: "error"; message: string };

/**
 * Scope for sending, in priority order: (1) All companies; (2) picked companies
 * plus companies named in the text (an ambiguous first word asks instead, and
 * more than 3 is an error); (3) the open company; (4) nothing → error.
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
 * Live scope for the header chip: the same priority as resolveSendScope, but an
 * ambiguous word or too many companies never blocks the preview.
 */
export function previewScope(input: ScopeInput): ScopePreview {
  if (input.allCompanies) {
    return { kind: "all" };
  }
  const picked = input.pickedIds.filter((id) => input.index.byId.has(id));
  const detected = detectCompanies(input.index, input.text, picked).companyIds;
  const ids = Array.from(new Set([...picked, ...detected]));
  const fallback =
    ids.length === 0 && input.openCompanyId && input.index.byId.has(input.openCompanyId)
      ? [input.openCompanyId]
      : ids;
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
