/**
 * generate-prospect-directory.ts
 * Reusable prospect-directory seeder — simulation content lives in config files.
 * Wipes and regenerates crm_prospect_directory + contacts for one simulation_id.
 * Reproducible: all randomness comes from config.seed (same seed → same output).
 * The live seed is secret: the CLI reads it from TEMPO_DIRECTORY_SEED and stops
 * before building anything when it is missing or invalid (tests pass their own).
 * Research findings are stored as [{ text, topics }]: every finding carries 1–2
 * topics from config.factTopics, and no finding text is shared by two companies.
 * Each trap's disqualifier is placed so the Data Room assistant's fact policy
 * shares it for "risks", "fit" and each of its own topics.
 * Runnable via: TEMPO_DIRECTORY_SEED=<seed> npx tsx scripts/generate-prospect-directory.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MAX_SHARED_FINDINGS } from "../lib/data-room-chat-policy";
import { QUESTION_TOPIC_FACT_TOPICS, type QuestionTopic } from "../lib/data-room-research-topics";
import {
  failsVisibleIcpAxis,
  scoreIcpFit,
  type IcpFitCompanyInput,
} from "./config/tempo-icp";
import { randomPerson } from "./shared/person-name-pool";
import { mulberry32 } from "./shared/seeded-random";

// ── Contact + company shapes ─────────────────────────────────────────────────

export interface ContactEntry {
  contactName: string;
  contactTitle: string;
  department: string;
  gender: "male" | "female";
}

export interface DesignedTrapContact extends ContactEntry {
  strongerAxis: string;
  weakerAxis: string;
}

export interface DesignedContactSet {
  correct: ContactEntry;
  traps: DesignedTrapContact[];
}

export type CompanyClass = "strong_fit" | "near_miss" | "trap" | "pass";
export type TriggerQuality = "strong" | "weak" | "none";

export type NearMissSubtype =
  | "too_small"
  | "no_strain"
  | "adjacent_vertical"
  | "too_big"
  | "out_of_territory";

export type TrapSubtype =
  | "already_solved"
  | "franchise_power"
  | "contracting"
  | "phantom_fit";

/** One research finding as stored in research_facts: its text and 1–2 topics. */
export type ResearchFinding = {
  text: string;
  topics: string[];
};

export interface DesignedCompany {
  companyName: string;
  vertical: string;
  locations: number;
  metro: string;
  inTerritory: boolean;
  sizeNote: string;
  onlineBooking: boolean;
  blurb: string;
  publicSignals: string[];
  researchFacts: ResearchFinding[];
  class: CompanyClass;
  subtype: string | null;
  fitRank: number | null;
  triggerQuality: TriggerQuality;
  keyedTrigger: string | null;
  bestContact: string | null;
  why: string | null;
  contactSet?: DesignedContactSet;
  /** Trap-only: the single discoverable disqualifier merged into research_facts at finalize. */
  trapDisqualifierFact?: string;
}

export interface ComparableAxis<TSubject> {
  name: string;
  keywords: string[];
  getValue: (subject: TSubject, config: TempoDirectorySeedConfig) => number | null;
}

export type FactPoolEntry = {
  text: string;
  theme: string;
};

export type TriggerSignatureTheme = {
  id: string;
  matchers: string[];
};

/** One measurable property checked for class correlation (simulation-agnostic). */
export type StructuralCorrelationProperty<TRecord> = {
  name: string;
  getValue: (record: TRecord) => number | string;
};

/** Config for validateNoStructuralClassCorrelation — no simulation-specific fields. */
export type StructuralCorrelationConfig<TRecord> = {
  getClass: (record: TRecord) => string;
  properties: StructuralCorrelationProperty<TRecord>[];
  /** Property names allowed to correlate with class (empty for Tempo). */
  exemptPropertyNames?: string[];
};

/** One string-list field checked for templated sentence frames (simulation-agnostic). */
export type TemplateDensityFieldConfig<TRecord> = {
  name: string;
  getStrings: (record: TRecord) => readonly string[];
  /** Max strings sharing one skeleton within a single record (default 2). */
  maxPerRecord?: number;
  /** Max share of corpus-wide strings one skeleton may occupy (default 0.15). */
  maxCorpusShare?: number;
};

/** Config for validateNoTemplateDensity — no simulation-specific field names. */
export type TemplateDensityConfig<TRecord> = {
  getRecordLabel: (record: TRecord) => string;
  fields: TemplateDensityFieldConfig<TRecord>[];
};

export interface TempoDirectorySeedConfig {
  simulationId: string;
  /** Seed for every random choice; the same seed always produces the same directory. */
  seed: number;
  /** Topic ids a research finding may carry. */
  factTopics: readonly string[];
  /** 1–2 topics for every fact-pool theme (researchFactsByVertical[*].theme). */
  themeToTopics: Record<string, string[]>;
  /** 1–2 topics for each trap subtype's disqualifier finding. */
  disqualifierTopicsBySubtype: Record<TrapSubtype, string[]>;
  authoredCompanies: DesignedCompany[];
  generationPlan: {
    strong_fit: number;
    near_miss: number;
    trap: number;
    pass: number;
  };
  corePainDepartment: string;
  /** Target-only: no other company may match more than one theme across public_signals. */
  targetTriggerSignatureThemes: TriggerSignatureTheme[];
  /** Per-vertical research fact pool with theme tags for within-company dedup. */
  researchFactsByVertical: Record<string, FactPoolEntry[]>;
  /** Per-vertical public signal pool for procedural generation. */
  publicSignalsByVertical: Record<string, string[]>;
  /** Trap-subtype public signals that avoid the target trigger signature pair. */
  publicSignalsByTrapSubtype: Record<TrapSubtype, string[]>;
  /** Keywords that identify disqualifier-themed facts for trap validation. */
  disqualifierKeywordsByTrapSubtype: Record<TrapSubtype, string[]>;
  /** Wording variants; each trap must receive a unique sentence from this pool. */
  trapDisqualifierVariantsBySubtype: Record<TrapSubtype, string[]>;
  /** Structural properties checked for answer-key class correlation before insert. */
  structuralCorrelation: StructuralCorrelationConfig<DesignedCompany>;
  /** String-list fields checked for templated sentence-frame density before insert. */
  templateDensity: TemplateDensityConfig<DesignedCompany>;
  verticalPool: string[];
  metroPoolInTerritory: string[];
  metroPoolOutOfTerritory: string[];
  passVerticalPool: string[];
  namePrefixPool: string[];
  nameDescriptorPool: string[];
  passPrefixPool: string[];
  suffixByVertical: Record<string, string[]>;
  passSuffixByVertical: Record<string, string[]>;
  contactTitlePool: string[];
  contactDepartmentPool: string[];
  contactTitleSeniorityRank: string[];
  contactComparableAxes: ComparableAxis<ContactEntry>[];
}

/** The simulation's content config: everything but the seed, which is secret (TEMPO_DIRECTORY_SEED). */
export type TempoDirectoryContentConfig = Omit<TempoDirectorySeedConfig, "seed">;

/** Seeds feed mulberry32, which keeps 32 bits: larger values would repeat smaller ones. */
const MAX_DIRECTORY_SEED = 4_294_967_295;

/**
 * Reads the live seed from TEMPO_DIRECTORY_SEED: a positive whole number up to
 * 4294967295. Throws a clear message when it is missing or invalid; there is no
 * default.
 */
export function parseDirectorySeed(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  const seed = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > MAX_DIRECTORY_SEED) {
    throw new Error(
      text
        ? `TEMPO_DIRECTORY_SEED must be a positive whole number up to ${MAX_DIRECTORY_SEED}. Nothing was generated.`
        : "TEMPO_DIRECTORY_SEED is not set. Set it to the secret directory seed (a positive whole number), e.g. TEMPO_DIRECTORY_SEED=<seed> npx tsx scripts/generate-prospect-directory.ts. Nothing was generated."
    );
  }
  return seed;
}

type EntryType = "target" | "crafted_decoy" | "filler";

type DirectoryRowInsert = {
  simulation_id: string;
  company_name: string;
  industry: string;
  size_locations: string;
  signal_hint: string;
  hidden_claim: string | null;
  entry_type: EntryType;
  is_active: boolean;
  in_data_room: boolean;
  vertical: string;
  locations: number;
  metro: string;
  in_territory: boolean;
  size_note: string;
  online_booking: boolean;
  blurb: string;
  public_signals: string[];
  research_facts: ResearchFinding[];
  class: CompanyClass;
  subtype: string | null;
  fit_rank: number | null;
  trigger_quality: TriggerQuality;
  keyed_trigger: string | null;
  best_contact: string | null;
  why: string | null;
};

type ContactRowInsert = {
  company_id: string;
  contact_name: string;
  contact_title: string;
  department: string;
  gender: "male" | "female";
  is_correct_contact: boolean;
  stronger_axis: string | null;
  weaker_axis: string | null;
};

type CompetitorWithAxes = {
  strongerAxis: string;
  weakerAxis: string;
};

export type GenerationReport = {
  warnings: string[];
  countsByClass: Record<CompanyClass, number>;
  countsBySubtype: Record<string, number>;
  mostReusedFact: { sentence: string; count: number } | null;
  mostReusedSignal: { sentence: string; count: number } | null;
  factReuseViolations: Array<{ sentence: string; count: number }>;
  signalReuseViolations: Array<{ sentence: string; count: number }>;
};

const GENERATION_RETRY_MAX = 80;
const MAX_FIRST_WORD_OCCURRENCES = 2;
const SUMMIT_FIRST_WORD = "summit";
/** A public signal may appear at up to two companies; a research finding at one. */
const MAX_SIGNAL_USES_ACROSS_COMPANIES = 2;
const MAX_FINDING_USES_ACROSS_COMPANIES = 1;
const MIN_RESEARCH_FACTS = 4;
const MAX_RESEARCH_FACTS = 7;
const MIN_FINDING_TOPICS = 1;
const MAX_FINDING_TOPICS = 2;
/** A finding with this share of its content words in its own company's public signals repeats them. */
const MAX_SIGNAL_OVERLAP_SHARE = 0.8;

/**
 * The run's random source. buildCompanyRoster seeds it from config.seed before any
 * random choice, so a run is reproducible.
 */
let random: () => number = (): number => {
  throw new Error("Random source used before buildCompanyRoster seeded it from config.seed.");
};

/**
 * Tracks trap disqualifier sentences — each may be used by at most one trap.
 */
class TrapDisqualifierAllocator {
  private readonly used = new Set<string>();

  registerAuthored(sentence: string): void {
    const key = sentence.trim().toLowerCase();
    if (this.used.has(key)) {
      throw new Error(`Duplicate trap disqualifier registered: "${sentence}"`);
    }
    this.used.add(key);
  }

  /** Picks an unused variant; `isAllowed` can rule out variants for this company. */
  allocate(
    subtype: TrapSubtype,
    variants: readonly string[],
    isAllowed: (variant: string) => boolean = (): boolean => true
  ): string {
    for (const variant of shuffle(variants)) {
      const key = variant.trim().toLowerCase();
      if (!this.used.has(key) && isAllowed(variant)) {
        this.used.add(key);
        return variant;
      }
    }
    throw new Error(
      `Trap disqualifier variants exhausted for subtype "${subtype}". Add more variants to trapDisqualifierVariantsBySubtype.`
    );
  }

  reset(): void {
    this.used.clear();
  }
}

const globalTrapDisqualifierAllocator = new TrapDisqualifierAllocator();

/**
 * Fails when a structural property value is exclusive to one class or absent from
 * a class that other classes take (simulation-agnostic).
 */
export function validateNoStructuralClassCorrelation<TRecord>(
  records: readonly TRecord[],
  config: StructuralCorrelationConfig<TRecord>
): void {
  const allClasses = new Set(records.map((record) => config.getClass(record)));

  for (const property of config.properties) {
    if (config.exemptPropertyNames?.includes(property.name)) {
      continue;
    }

    const valueToClasses = new Map<string | number, Set<string>>();
    const classToValues = new Map<string, Set<string | number>>();

    for (const record of records) {
      const companyClass = config.getClass(record);
      const value = property.getValue(record);

      const classesForValue = valueToClasses.get(value) ?? new Set<string>();
      classesForValue.add(companyClass);
      valueToClasses.set(value, classesForValue);

      const valuesForClass = classToValues.get(companyClass) ?? new Set<string | number>();
      valuesForClass.add(value);
      classToValues.set(companyClass, valuesForClass);
    }

    for (const [value, classesWithValue] of Array.from(valueToClasses.entries())) {
      if (classesWithValue.size === 1 && allClasses.size > 1) {
        const onlyClass = Array.from(classesWithValue)[0] as string;
        throw new Error(
          `Structural leak: ${property.name} value ${JSON.stringify(value)} occurs only in class '${onlyClass}'`
        );
      }
    }

    const valuesSeenAnywhere = Array.from(valueToClasses.keys());
    for (const companyClass of Array.from(allClasses)) {
      const valuesForClass = classToValues.get(companyClass) ?? new Set<string | number>();
      for (const value of valuesSeenAnywhere) {
        const classesWithValue = valueToClasses.get(value) as Set<string>;
        if (classesWithValue.size === 0) {
          continue;
        }
        if (!valuesForClass.has(value)) {
          throw new Error(
            `Structural leak: class '${companyClass}' never takes ${property.name} value ${JSON.stringify(value)}, which other classes take`
          );
        }
      }
    }
  }
}

/**
 * Reduces a sentence to a skeleton for template matching: lowercase, strip punctuation,
 * keep first three and last three tokens (drops variable middle).
 */
export function toSentenceSkeleton(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter((word) => word.length > 0);
  if (words.length <= 6) {
    return words.join(" ");
  }
  return [...words.slice(0, 3), ...words.slice(-3)].join(" ");
}

export type TemplateDensityReport = {
  mostCommonSkeleton: { skeleton: string; count: number; share: number } | null;
};

/**
 * Fails when templated sentence frames cluster within records or dominate the corpus.
 */
export function validateNoTemplateDensity<TRecord>(
  records: readonly TRecord[],
  config: TemplateDensityConfig<TRecord>
): TemplateDensityReport {
  let globalBest: { skeleton: string; count: number } | null = null;
  let globalTotal = 0;

  for (const field of config.fields) {
    const maxPerRecord = field.maxPerRecord ?? 2;
    const maxCorpusShare = field.maxCorpusShare ?? 0.15;
    const skeletonCorpusCounts = new Map<string, number>();
    let fieldTotal = 0;

    for (const record of records) {
      const strings = field.getStrings(record);
      const skeletonCounts = new Map<string, number>();
      const skeletonToOriginal = new Map<string, string>();

      for (const value of strings) {
        const skeleton = toSentenceSkeleton(value);
        skeletonCounts.set(skeleton, (skeletonCounts.get(skeleton) ?? 0) + 1);
        skeletonToOriginal.set(skeleton, value);
        skeletonCorpusCounts.set(skeleton, (skeletonCorpusCounts.get(skeleton) ?? 0) + 1);
        fieldTotal += 1;
      }

      for (const [skeleton, count] of Array.from(skeletonCounts.entries())) {
        if (count > maxPerRecord) {
          throw new Error(
            `Template density: record "${config.getRecordLabel(record)}" has ${count} strings sharing skeleton "${skeleton}" in field "${field.name}" (max ${maxPerRecord})`
          );
        }
      }

      const dominant = Array.from(skeletonCounts.entries()).filter(([, count]) => count >= 3);
      const singletons = Array.from(skeletonCounts.entries()).filter(([, count]) => count === 1);
      if (dominant.length > 0 && singletons.length === 1) {
        const outlierSkeleton = singletons[0]?.[0] ?? "";
        const outlierText = skeletonToOriginal.get(outlierSkeleton) ?? outlierSkeleton;
        throw new Error(
          `Template odd-one-out: record "${config.getRecordLabel(record)}" has 3+ strings sharing skeleton "${dominant[0]?.[0]}" and one structurally distinct string in field "${field.name}": "${outlierText}"`
        );
      }
    }

    globalTotal += fieldTotal;
    for (const [skeleton, count] of Array.from(skeletonCorpusCounts.entries())) {
      if (!globalBest || count > globalBest.count) {
        globalBest = { skeleton, count };
      }
      const share = fieldTotal > 0 ? count / fieldTotal : 0;
      if (share > maxCorpusShare) {
        throw new Error(
          `Template corpus density: skeleton "${skeleton}" accounts for ${(share * 100).toFixed(1)}% of all strings in field "${field.name}" (max ${(maxCorpusShare * 100).toFixed(0)}%)`
        );
      }
    }
  }

  return {
    mostCommonSkeleton:
      globalBest && globalTotal > 0
        ? {
            skeleton: globalBest.skeleton,
            count: globalBest.count,
            share: globalBest.count / globalTotal,
          }
        : null,
  };
}

/**
 * Picks a trap disqualifier insert index biased toward the middle and end of the array.
 */
function weightedTrapDisqualifierIndex(neutralCount: number): number {
  if (neutralCount <= 0) {
    return 1;
  }
  const biased = Math.pow(random(), 0.35);
  return 1 + Math.floor(biased * neutralCount);
}

/**
 * Cap safety: the Data Room assistant shares, for a question topic, only the first
 * MAX_SHARED_FINDINGS findings (stored order) whose topics answer it. A trap's
 * disqualifier is shared for "risks", "fit" and each of its own topics when its
 * topics answer each of them and fewer than MAX_SHARED_FINDINGS of the findings
 * before it match.
 */
function isDisqualifierCapSafe(
  findingsBefore: readonly ResearchFinding[],
  disqualifierTopics: readonly string[]
): boolean {
  const questionTopics = ["risks", "fit", ...disqualifierTopics] as QuestionTopic[];
  return questionTopics.every((questionTopic) => {
    const answering = new Set<string>(QUESTION_TOPIC_FACT_TOPICS[questionTopic] ?? []);
    const matching = findingsBefore.filter((finding) => finding.topics.some((topic) => answering.has(topic)));
    return disqualifierTopics.some((topic) => answering.has(topic)) && matching.length < MAX_SHARED_FINDINGS;
  });
}

/**
 * The last insert index (≥ 1, never first) at which the disqualifier is cap-safe
 * among the neutral findings before it. Index 1 always is (one finding before it).
 */
function lastCapSafeInsertIndex(neutral: readonly ResearchFinding[], disqualifierTopics: readonly string[]): number {
  let last = 1;
  while (last < neutral.length && isDisqualifierCapSafe(neutral.slice(0, last + 1), disqualifierTopics)) {
    last += 1;
  }
  return last;
}

const NEAR_MISS_SUBTYPES: NearMissSubtype[] = [
  "too_small",
  "no_strain",
  "adjacent_vertical",
  "too_big",
  "out_of_territory",
];

const TRAP_SUBTYPES: TrapSubtype[] = [
  "already_solved",
  "franchise_power",
  "contracting",
  "phantom_fit",
];

/**
 * Picks a random element from a non-empty array.
 */
function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/**
 * Normalizes company names for uniqueness checks (R6).
 */
export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const ALLOWED_SUMMIT_NAMES = new Set(
  ["Summit Dental Group", "Summit Outdoor Gear"].map(normalizeCompanyName)
);

/**
 * Returns the first whitespace-delimited token of a company name.
 */
export function companyFirstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * Fisher–Yates shuffle (returns a new array).
 */
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

/**
 * Builds a per-class spread of fact counts in [4, 7] with all four values
 * represented when the class has four or more companies.
 */
export function spreadFactCounts(classSize: number): number[] {
  if (classSize <= 0) {
    return [];
  }
  const cycle = [4, 5, 6, 7];
  const counts: number[] = [];
  while (counts.length < classSize) {
    counts.push(cycle[counts.length % cycle.length] as number);
  }
  if (classSize >= 4) {
    for (let index = 0; index < 4; index += 1) {
      if (!counts.includes(cycle[index] as number)) {
        counts[index] = cycle[index] as number;
      }
    }
  }
  return shuffle(counts);
}

/**
 * Sentence key for uniqueness checks: lowercase, punctuation and whitespace collapsed.
 */
export function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Tracks sentence reuse across all companies (one registry for findings, one for
 * public signals), each with its own limit.
 */
class SentenceUsageRegistry {
  private readonly counts = new Map<string, number>();

  constructor(private readonly maxUses: number) {}

  canUse(sentence: string): boolean {
    return (this.counts.get(normalizeSentence(sentence)) ?? 0) < this.maxUses;
  }

  register(sentence: string): void {
    const key = normalizeSentence(sentence);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  violations(): Array<{ sentence: string; count: number }> {
    return Array.from(this.counts.entries())
      .filter(([, count]) => count > this.maxUses)
      .map(([sentence, count]) => ({ sentence, count }));
  }

  mostReused(): { sentence: string; count: number } | null {
    let best: { sentence: string; count: number } | null = null;
    for (const [sentence, count] of Array.from(this.counts.entries())) {
      if (!best || count > best.count) {
        best = { sentence, count };
      }
    }
    return best;
  }

  reset(): void {
    this.counts.clear();
  }
}

const globalFactUsage = new SentenceUsageRegistry(MAX_FINDING_USES_ACROSS_COMPANIES);
const globalSignalUsage = new SentenceUsageRegistry(MAX_SIGNAL_USES_ACROSS_COMPANIES);

// Words too common to show that a finding repeats a public signal.
const OVERLAP_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "their", "they", "have", "has",
  "had", "was", "were", "are", "its", "not", "but", "into", "over", "than", "been",
  "also", "which", "who", "will", "about", "after", "more", "most", "some", "any",
  "all", "one", "out", "per", "via", "our",
]);

function contentWords(text: string): string[] {
  return normalizeSentence(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !OVERLAP_STOP_WORDS.has(word));
}

/**
 * True when at least MAX_SIGNAL_OVERLAP_SHARE of a finding's distinct content words
 * appear in the company's public signals (the finding would just repeat them).
 */
export function findingRepeatsSignals(finding: string, signals: readonly string[]): boolean {
  const words = Array.from(new Set(contentWords(finding)));
  if (words.length === 0) {
    return false;
  }
  const signalWords = new Set(signals.flatMap(contentWords));
  const shared = words.filter((word) => signalWords.has(word)).length;
  return shared / words.length >= MAX_SIGNAL_OVERLAP_SHARE;
}

function textMatchesAny(text: string, matchers: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return matchers.some((matcher) => lower.includes(matcher.toLowerCase()));
}

export function countMatchedTriggerThemes(
  signals: readonly string[],
  themes: readonly TriggerSignatureTheme[]
): number {
  const matched = new Set<string>();
  for (const theme of themes) {
    if (signals.some((signal) => textMatchesAny(signal, theme.matchers))) {
      matched.add(theme.id);
    }
  }
  return matched.size;
}

function factMatchesDisqualifierTheme(
  fact: string,
  subtype: TrapSubtype,
  config: TempoDirectorySeedConfig
): boolean {
  const keywords = config.disqualifierKeywordsByTrapSubtype[subtype] ?? [];
  return textMatchesAny(fact, keywords);
}

function allocateResearchFacts(
  company: DesignedCompany,
  count: number,
  existing: readonly ResearchFinding[],
  config: TempoDirectorySeedConfig,
  excludeDisqualifierThemes = false,
  disqualifierSubtype?: TrapSubtype
): ResearchFinding[] {
  const pool = config.researchFactsByVertical[company.vertical];
  if (!pool || pool.length === 0) {
    throw new Error(
      `No research fact pool for vertical "${company.vertical}". Expand researchFactsByVertical.`
    );
  }

  const usedTexts = new Set(existing.map((fact) => normalizeSentence(fact.text)));
  const usedThemes = new Set<string>();
  for (const fact of existing) {
    const entry = pool.find((item) => normalizeSentence(item.text) === normalizeSentence(fact.text));
    if (entry) {
      usedThemes.add(entry.theme);
    }
  }

  const picked: ResearchFinding[] = [];
  for (const entry of shuffle(pool)) {
    if (picked.length >= count) {
      break;
    }
    const key = normalizeSentence(entry.text);
    if (usedTexts.has(key) || usedThemes.has(entry.theme)) {
      continue;
    }
    if (!globalFactUsage.canUse(entry.text)) {
      continue;
    }
    if (findingRepeatsSignals(entry.text, company.publicSignals)) {
      continue;
    }
    if (
      excludeDisqualifierThemes &&
      disqualifierSubtype &&
      factMatchesDisqualifierTheme(entry.text, disqualifierSubtype, config)
    ) {
      continue;
    }
    // validateTopicConfig guarantees every pool theme has topics.
    picked.push({ text: entry.text, topics: [...config.themeToTopics[entry.theme]] });
    usedTexts.add(key);
    usedThemes.add(entry.theme);
    globalFactUsage.register(entry.text);
  }

  if (picked.length < count) {
    throw new Error(
      `Research fact pool for "${company.vertical}" too small for ${count} themed facts (got ${picked.length}).`
    );
  }

  return picked;
}

function allocatePublicSignals(
  pool: readonly string[],
  count: number,
  existing: readonly string[] = []
): string[] {
  const used = new Set(existing.map((signal) => signal.trim().toLowerCase()));
  const picked: string[] = [...existing];
  for (const signal of shuffle(pool)) {
    if (picked.length >= count) {
      break;
    }
    const key = signal.trim().toLowerCase();
    if (used.has(key) || !globalSignalUsage.canUse(signal)) {
      continue;
    }
    picked.push(signal);
    used.add(key);
    globalSignalUsage.register(signal);
  }

  if (picked.length < count) {
    throw new Error(
      `Public signal pool too small for ${count} signals (got ${picked.length}).`
    );
  }

  return picked.slice(0, count);
}

function registerAuthoredSentences(companies: readonly DesignedCompany[]): void {
  for (const company of companies) {
    for (const fact of company.researchFacts) {
      globalFactUsage.register(fact.text);
    }
    for (const signal of company.publicSignals) {
      globalSignalUsage.register(signal);
    }
  }
}

type BlurbBucket = "short" | "medium" | "long";

function blurbLengthBucket(blurb: string): BlurbBucket {
  const length = blurb.trim().length;
  if (length < 80) {
    return "short";
  }
  if (length <= 150) {
    return "medium";
  }
  return "long";
}

/**
 * Assigns short/medium/long blurbs so each class can cover every bucket.
 */
class BlurbBucketPlanner {
  private readonly countsByClass = new Map<CompanyClass, Map<BlurbBucket, number>>();
  private readonly cycle: BlurbBucket[] = ["short", "medium", "long"];
  private cycleIndex = 0;

  registerAuthored(companyClass: CompanyClass, blurb: string): void {
    const bucket = blurbLengthBucket(blurb);
    const counts = this.countsByClass.get(companyClass) ?? new Map<BlurbBucket, number>();
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    this.countsByClass.set(companyClass, counts);
  }

  nextBucket(companyClass: CompanyClass): BlurbBucket {
    const counts = this.countsByClass.get(companyClass) ?? new Map<BlurbBucket, number>();
    for (let attempt = 0; attempt < this.cycle.length * 2; attempt += 1) {
      const bucket = this.cycle[this.cycleIndex % this.cycle.length] as BlurbBucket;
      this.cycleIndex += 1;
      const current = counts.get(bucket) ?? 0;
      const minCount = Math.min(
        ...this.cycle.map((candidate) => counts.get(candidate) ?? 0)
      );
      if (current <= minCount) {
        counts.set(bucket, current + 1);
        this.countsByClass.set(companyClass, counts);
        return bucket;
      }
    }
    const fallback = this.cycle[this.cycleIndex % this.cycle.length] as BlurbBucket;
    this.cycleIndex += 1;
    counts.set(fallback, (counts.get(fallback) ?? 0) + 1);
    this.countsByClass.set(companyClass, counts);
    return fallback;
  }

  /** Starts a new run (otherwise counts carry over and runs stop being reproducible). */
  reset(): void {
    this.countsByClass.clear();
    this.cycleIndex = 0;
  }
}

const globalBlurbBucketPlanner = new BlurbBucketPlanner();

/**
 * Spreads companies evenly across verticals: each pick is a random vertical among
 * those with the fewest companies so far (authored companies count). Keeps every
 * vertical's research-fact pool within reach, since findings are never shared.
 */
class VerticalBalancer {
  private readonly counts = new Map<string, number>();

  /** Counts a company that was actually added to the roster. */
  register(vertical: string): void {
    this.counts.set(vertical, (this.counts.get(vertical) ?? 0) + 1);
  }

  pick(pool: readonly string[]): string {
    const least = Math.min(...pool.map((vertical) => this.counts.get(vertical) ?? 0));
    return pickRandom(pool.filter((vertical) => (this.counts.get(vertical) ?? 0) === least));
  }

  reset(): void {
    this.counts.clear();
  }
}

const globalVerticalBalancer = new VerticalBalancer();

function proceduralBlurb(vertical: string, metro: string, bucket: BlurbBucket): string {
  const industry = verticalToIndustry(vertical);
  if (bucket === "short") {
    return `${industry} operator in ${metro}.`;
  }
  if (bucket === "medium") {
    return `${industry} group operating across ${metro} with routine multi-location patient operations.`;
  }
  return `${industry} group operating across ${metro} with routine multi-location patient operations. Regional coverage has described the organization as an established community operator with steady clinic demand.`;
}

/**
 * Tracks company-name uniqueness, first-word limits, and substring collisions.
 */
export class CompanyNameRegistry {
  private readonly usedNames = new Set<string>();
  private readonly firstWordCounts = new Map<string, number>();

  /**
   * Registers an authored name that must be accepted as-is.
   */
  registerAuthored(name: string): void {
    if (!this.tryRegister(name)) {
      throw new Error(`Authored company name "${name}" violates name registry rules.`);
    }
  }

  /**
   * Attempts to register a candidate company name. Returns false when rejected.
   */
  tryRegister(name: string): boolean {
    if (name.includes("(") || name.includes(")")) {
      return false;
    }
    const normalized = normalizeCompanyName(name);
    if (this.usedNames.has(normalized)) {
      return false;
    }
    for (const existing of Array.from(this.usedNames)) {
      if (normalized.includes(existing) || existing.includes(normalized)) {
        return false;
      }
    }
    const firstWord = companyFirstWord(name).toLowerCase();
    if (firstWord === SUMMIT_FIRST_WORD && !ALLOWED_SUMMIT_NAMES.has(normalized)) {
      return false;
    }
    const count = this.firstWordCounts.get(firstWord) ?? 0;
    if (count >= MAX_FIRST_WORD_OCCURRENCES) {
      return false;
    }
    this.usedNames.add(normalized);
    this.firstWordCounts.set(firstWord, count + 1);
    return true;
  }

  get size(): number {
    return this.usedNames.size;
  }
}

/**
 * Expands every company's research_facts to an assigned count in [4, 7].
 */
export function finalizeResearchFacts(
  companies: DesignedCompany[],
  config: TempoDirectorySeedConfig
): void {
  const byClass = new Map<CompanyClass, DesignedCompany[]>();
  for (const company of companies) {
    const group = byClass.get(company.class) ?? [];
    group.push(company);
    byClass.set(company.class, group);
  }

  for (const [, group] of Array.from(byClass.entries())) {
    const targets = spreadFactCounts(group.length);
    for (let index = 0; index < group.length; index += 1) {
      const company = group[index] as DesignedCompany;
      const targetCount = targets[index] as number;
      const trapSubtype =
        company.class === "trap" && company.subtype
          ? (company.subtype as TrapSubtype)
          : undefined;
      const disqualifier: ResearchFinding | null =
        trapSubtype && company.trapDisqualifierFact
          ? {
              text: company.trapDisqualifierFact,
              topics: [...config.disqualifierTopicsBySubtype[trapSubtype]],
            }
          : null;

      let seedFacts = company.researchFacts.filter(
        (fact) => !disqualifier || fact.text.trim() !== disqualifier.text.trim()
      );
      if (trapSubtype) {
        seedFacts = seedFacts.filter(
          (fact) => !factMatchesDisqualifierTheme(fact.text, trapSubtype, config)
        );
      }

      const neededNeutral = targetCount - seedFacts.length - (disqualifier ? 1 : 0);
      const padding =
        neededNeutral > 0
          ? allocateResearchFacts(
              company,
              neededNeutral,
              [...seedFacts, ...(disqualifier ? [disqualifier] : [])],
              config,
              company.class === "trap",
              trapSubtype
            )
          : [];

      const neutralFacts = [...seedFacts, ...padding].slice(
        0,
        targetCount - (disqualifier ? 1 : 0)
      );

      if (disqualifier) {
        // Seeded position, limited to the cap-safe range so "risks", "fit" and the
        // disqualifier's own topics all share it (a no-op when every position is safe).
        const insertAt = weightedTrapDisqualifierIndex(
          lastCapSafeInsertIndex(neutralFacts, disqualifier.topics)
        );
        company.researchFacts = [
          ...neutralFacts.slice(0, insertAt),
          disqualifier,
          ...neutralFacts.slice(insertAt),
        ];
      } else {
        company.researchFacts = neutralFacts.slice(0, targetCount);
      }

      if (
        company.researchFacts.length < MIN_RESEARCH_FACTS ||
        company.researchFacts.length > MAX_RESEARCH_FACTS
      ) {
        throw new Error(
          `research_facts for "${company.companyName}" must be between ${MIN_RESEARCH_FACTS} and ${MAX_RESEARCH_FACTS} after finalize (got ${company.researchFacts.length}).`
        );
      }
    }
  }
}

/**
 * Maps a vertical slug to a display industry label for legacy columns.
 */
export function verticalToIndustry(vertical: string): string {
  const labels: Record<string, string> = {
    dental: "Dental",
    veterinary: "Veterinary",
    "physical therapy": "Physical Therapy",
    optometry: "Optometry",
    "med spa": "Med Spa",
    chiropractic: "Chiropractic",
    retail: "Retail",
    hospitality: "Hospitality",
    "auto repair": "Auto Repair",
    "legal services": "Legal Services",
    "fitness studio": "Fitness Studio",
    "property management": "Property Management",
    "urgent care": "Urgent Care",
  };
  return labels[vertical.toLowerCase()] ?? vertical;
}

/**
 * Converts a designed company into ICP scoring input.
 */
function toIcpInput(company: DesignedCompany): IcpFitCompanyInput {
  return {
    vertical: company.vertical,
    locations: company.locations,
    metro: company.metro,
    onlineBooking: company.onlineBooking,
  };
}

/**
 * Generic win-count validator for designed trap contacts.
 */
export function validateCompetitorsAgainstCanonical<TSubject>(options: {
  candidates: Array<TSubject & CompetitorWithAxes>;
  canonical: TSubject;
  axes: Array<Pick<ComparableAxis<TSubject>, "name" | "keywords" | "getValue">>;
  config: TempoDirectorySeedConfig;
  labelFor: (candidate: TSubject & CompetitorWithAxes) => string;
}): void {
  const { candidates, canonical, axes, config, labelFor } = options;

  for (const candidate of candidates) {
    const label = labelFor(candidate);
    if (!candidate.strongerAxis?.trim()) {
      throw new Error(`Competitor "${label}" is missing required field strongerAxis.`);
    }
    if (!candidate.weakerAxis?.trim()) {
      throw new Error(`Competitor "${label}" is missing required field weakerAxis.`);
    }

    const winningAxes = axes.filter((axis) => {
      const candidateValue = axis.getValue(candidate, config);
      const canonicalValue = axis.getValue(canonical, config);
      return (
        candidateValue !== null &&
        canonicalValue !== null &&
        candidateValue > canonicalValue
      );
    });

    if (winningAxes.length > 1) {
      throw new Error(
        `Competitor "${label}" out-performs the canonical subject on multiple axes: ${winningAxes
          .map((axis) => axis.name)
          .join(", ")}.`
      );
    }

    if (winningAxes.length === 0) {
      console.warn(
        `[generate-prospect-directory] Competitor "${label}" does not measurably out-perform the canonical subject on any configured axis; double-check that this is intentional.`
      );
      continue;
    }

    const winningAxis = winningAxes[0];
    const declaredStrength = candidate.strongerAxis.toLowerCase();
    const referencesWinningAxis = winningAxis.keywords.some((keyword) =>
      declaredStrength.includes(keyword.toLowerCase())
    );
    if (!referencesWinningAxis) {
      console.warn(
        `[generate-prospect-directory] Competitor "${label}" wins on axis "${winningAxis.name}", but strongerAxis may not reference that measured strength.`
      );
    }
  }
}

/**
 * Validates designed contact sets for companies that declare them.
 */
export function validateDesignedContactSets(
  companies: DesignedCompany[],
  config: TempoDirectorySeedConfig
): void {
  for (const company of companies) {
    if (company.class !== "pass" && !company.contactSet) {
      throw new Error(
        `Company "${company.companyName}" (${company.class}) is missing contactSet.`
      );
    }
    if (!company.contactSet) {
      continue;
    }
    const label = company.companyName.trim() || "(unnamed company)";
    if (!company.contactSet.correct) {
      throw new Error(`Designed company "${label}" is missing contactSet.correct.`);
    }
    if (!Array.isArray(company.contactSet.traps) || company.contactSet.traps.length !== 2) {
      throw new Error(
        `Designed company "${label}" must declare exactly 2 trap contacts in contactSet.traps.`
      );
    }

    validateCompetitorsAgainstCanonical({
      candidates: company.contactSet.traps,
      canonical: company.contactSet.correct,
      axes: config.contactComparableAxes,
      config,
      labelFor: (trap) =>
        `${label} / ${trap.contactName.trim() || "(unnamed trap contact)"}`,
    });
  }
}

/**
 * Builds a unique company name from prefix/suffix pools without parenthetical fallbacks.
 */
function buildUniqueCompanyName(
  registry: CompanyNameRegistry,
  prefix: string,
  suffix: string,
  config: TempoDirectorySeedConfig
): string | null {
  const candidates: string[] = [`${prefix} ${suffix}`];
  for (const descriptor of shuffle(config.nameDescriptorPool)) {
    candidates.push(`${prefix} ${descriptor} ${suffix}`);
  }

  for (const candidate of candidates) {
    if (registry.tryRegister(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Builds a unique pass-class company name from pass-specific pools.
 */
function buildUniquePassCompanyName(
  registry: CompanyNameRegistry,
  config: TempoDirectorySeedConfig,
  vertical: string
): string | null {
  const suffixes = config.passSuffixByVertical[vertical] ?? ["Group"];
  const prefixes = shuffle(config.passPrefixPool);

  for (const prefix of prefixes) {
    for (const suffix of shuffle(suffixes)) {
      const candidates = [`${prefix} ${suffix}`];
      for (const descriptor of shuffle(config.nameDescriptorPool)) {
        candidates.push(`${prefix} ${descriptor} ${suffix}`);
      }
      for (const candidate of candidates) {
        if (registry.tryRegister(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

const globalUsedContactNames = new Set<string>();

function normalizeContactName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Registers authored contact names so procedural generation avoids collisions.
 */
export function registerAuthoredContactNames(companies: DesignedCompany[]): void {
  for (const company of companies) {
    if (!company.contactSet) {
      continue;
    }
    for (const contact of [company.contactSet.correct, ...company.contactSet.traps]) {
      globalUsedContactNames.add(normalizeContactName(contact.contactName));
    }
  }
}

/**
 * Returns a person with a globally unique full name for this generation run.
 */
function randomUniquePerson(): ReturnType<typeof randomPerson> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const person = randomPerson(random);
    const fullName = normalizeContactName(`${person.firstName} ${person.lastName}`);
    if (!globalUsedContactNames.has(fullName)) {
      globalUsedContactNames.add(fullName);
      return person;
    }
  }
  throw new Error(
    "Person name pool too small: could not allocate a unique contact full name. Expand person-name-pool.ts."
  );
}

/**
 * Builds a procedural contact set with one correct contact and two traps.
 */
function buildProceduralContactSet(
  config: TempoDirectorySeedConfig,
  bestTitle = "Director of Operations"
): DesignedContactSet {
  const correctPerson = randomUniquePerson();
  const trapOnePerson = randomUniquePerson();
  const trapTwoPerson = randomUniquePerson();
  const correct: ContactEntry = {
    contactName: `${correctPerson.firstName} ${correctPerson.lastName}`,
    contactTitle: bestTitle,
    department: config.corePainDepartment,
    gender: correctPerson.gender,
  };

  return {
    correct,
    traps: [
      {
        contactName: `${trapOnePerson.firstName} ${trapOnePerson.lastName}`,
        contactTitle: "VP of Finance",
        department: "Finance",
        gender: trapOnePerson.gender,
        strongerAxis: "seniority — VP outranks the operations lead on paper",
        weakerAxis: "wrong department — Finance does not own scheduling tooling",
      },
      {
        contactName: `${trapTwoPerson.firstName} ${trapTwoPerson.lastName}`,
        contactTitle: "Front Desk Lead",
        department: config.corePainDepartment,
        gender: trapTwoPerson.gender,
        strongerAxis:
          "department relevance — front-line role closest to scheduling friction",
        weakerAxis: "insufficient seniority to approve a vendor purchase",
      },
    ],
  };
}

/**
 * Creates one procedural near-miss company for a requested subtype.
 */
function buildNearMissCompany(
  subtype: NearMissSubtype,
  config: TempoDirectorySeedConfig,
  registry: CompanyNameRegistry
): DesignedCompany {
  for (let attempt = 0; attempt < GENERATION_RETRY_MAX; attempt += 1) {
    const vertical =
      subtype === "adjacent_vertical" ? "urgent care" : globalVerticalBalancer.pick(config.verticalPool);
    const suffixes =
      subtype === "adjacent_vertical"
        ? ["Urgent Care", "Walk-In Clinic"]
        : config.suffixByVertical[vertical] ?? ["Group"];
    const companyName = buildUniqueCompanyName(
      registry,
      pickRandom(config.namePrefixPool),
      pickRandom(suffixes),
      config
    );
    if (!companyName) {
      continue;
    }

    let locations = pickRandom([4, 5, 6, 7, 8]);
    let metro = pickRandom(config.metroPoolInTerritory);
    let onlineBooking = false;
    let triggerQuality: TriggerQuality = "weak";
    let keyedTrigger: string | null = "Operational review cycle";
    let publicSignals = allocatePublicSignals(
      config.publicSignalsByVertical[vertical] ?? [],
      3
    );
    let researchFacts: ResearchFinding[] = [];

    if (subtype === "too_small") {
      locations = pickRandom([1, 2]);
    } else if (subtype === "too_big") {
      locations = pickRandom([13, 14, 15, 18]);
    } else if (subtype === "out_of_territory") {
      metro = pickRandom(config.metroPoolOutOfTerritory);
    } else if (subtype === "no_strain") {
      triggerQuality = "none";
      keyedTrigger = null;
      publicSignals = allocatePublicSignals(
        (config.publicSignalsByVertical[vertical] ?? []).filter(
          (signal) =>
            countMatchedTriggerThemes([signal], config.targetTriggerSignatureThemes) === 0
        ),
        3
      );
      researchFacts = [];
    } else {
      researchFacts = [];
    }

    const inTerritory = config.metroPoolInTerritory.includes(metro);
    const contactSet = buildProceduralContactSet(config);
    const company: DesignedCompany = {
      companyName,
      vertical,
      locations,
      metro,
      inTerritory,
      sizeNote: `${locations} location${locations === 1 ? "" : "s"}`,
      onlineBooking,
      blurb: proceduralBlurb(
        vertical,
        metro,
        globalBlurbBucketPlanner.nextBucket("near_miss")
      ),
      publicSignals,
      researchFacts,
      class: "near_miss",
      subtype,
      fitRank: null,
      triggerQuality,
      keyedTrigger,
      bestContact: contactSet.correct.contactName,
      why: `Near-miss (${subtype}) — defensible but weaker than the room's top fit.`,
      contactSet,
    };
    const score = scoreIcpFit(toIcpInput(company));
    const failsAxisOrTrigger =
      score.axesPassed < 4 || company.triggerQuality === "none" || company.triggerQuality === "weak";
    const triggerThemes = countMatchedTriggerThemes(
      company.publicSignals,
      config.targetTriggerSignatureThemes
    );
    if (!failsAxisOrTrigger || triggerThemes > 1) {
      continue;
    }

    globalVerticalBalancer.register(company.vertical);
    return company;
  }

  throw new Error(
    `Could not build near_miss company for subtype "${subtype}". Expand name pools if name allocation failed.`
  );
}

/**
 * Creates one procedural trap company for a requested subtype.
 */
function buildTrapCompany(
  subtype: TrapSubtype,
  config: TempoDirectorySeedConfig,
  registry: CompanyNameRegistry
): DesignedCompany {
  for (let attempt = 0; attempt < GENERATION_RETRY_MAX; attempt += 1) {
    const vertical = globalVerticalBalancer.pick(config.verticalPool);
    const suffixes = config.suffixByVertical[vertical] ?? ["Group"];
    const companyName = buildUniqueCompanyName(
      registry,
      pickRandom(config.namePrefixPool),
      pickRandom(suffixes),
      config
    );
    if (!companyName) {
      continue;
    }

    const locations = pickRandom([4, 5, 6, 7, 8, 9, 10]);
    const metro = pickRandom(config.metroPoolInTerritory);
    let onlineBooking = false;
    let triggerQuality: TriggerQuality = pickRandom(["strong", "weak"] as const);
    let researchFacts: ResearchFinding[] = [];
    const signalPool = config.publicSignalsByTrapSubtype[subtype];
    let publicSignals = allocatePublicSignals(signalPool, 3);
    let keyedTrigger = "Operational growth signals";
    // The disqualifier is research the student must dig for: never a repeat of its own signals.
    const trapDisqualifierFact = globalTrapDisqualifierAllocator.allocate(
      subtype,
      config.trapDisqualifierVariantsBySubtype[subtype],
      (variant) => !findingRepeatsSignals(variant, publicSignals)
    );

    if (subtype === "already_solved") {
      onlineBooking = true;
      keyedTrigger = "Portal refresh marketing push";
    } else if (subtype === "contracting") {
      triggerQuality = "strong";
      keyedTrigger = "Administrative staff reduction";
    } else if (subtype === "phantom_fit") {
      keyedTrigger = "Announced location opening";
    } else if (subtype === "franchise_power") {
      keyedTrigger = "Regional expansion coverage";
    }

    const contactSet = buildProceduralContactSet(config);
    const company: DesignedCompany = {
      companyName,
      vertical,
      locations,
      metro,
      inTerritory: true,
      sizeNote: `${locations} locations`,
      onlineBooking,
      blurb: proceduralBlurb(
        vertical,
        metro,
        globalBlurbBucketPlanner.nextBucket("trap")
      ),
      publicSignals,
      researchFacts,
      class: "trap",
      subtype,
      fitRank: null,
      triggerQuality,
      keyedTrigger,
      bestContact: contactSet.correct.contactName,
      why: `Trap (${subtype}) — attractive on the card, disqualifier lives in research.`,
      contactSet,
      trapDisqualifierFact,
    };
    const score = scoreIcpFit(toIcpInput(company));
    const attractive =
      score.axesPassed >= 3 &&
      (company.triggerQuality === "strong" || company.triggerQuality === "weak");
    const triggerThemes = countMatchedTriggerThemes(
      company.publicSignals,
      config.targetTriggerSignatureThemes
    );
    if (!attractive || triggerThemes > 1) {
      continue;
    }

    globalVerticalBalancer.register(company.vertical);
    return company;
  }

  throw new Error(
    `Could not build trap company for subtype "${subtype}". Expand name pools if name allocation failed.`
  );
}

/**
 * Creates one procedural strong_fit company that cannot outrank Summit (R2).
 */
function buildSecondaryStrongFit(
  config: TempoDirectorySeedConfig,
  registry: CompanyNameRegistry
): DesignedCompany {
  for (let attempt = 0; attempt < GENERATION_RETRY_MAX; attempt += 1) {
    const vertical = globalVerticalBalancer.pick(config.verticalPool);
    const suffixes = config.suffixByVertical[vertical] ?? ["Group"];
    const companyName = buildUniqueCompanyName(
      registry,
      pickRandom(config.namePrefixPool),
      pickRandom(suffixes),
      config
    );
    if (!companyName) {
      continue;
    }

    const locations = pickRandom([4, 5, 6, 7, 9, 10]);
    const metro = pickRandom(config.metroPoolInTerritory);
    const triggerQuality: TriggerQuality =
      random() < 0.5 ? "weak" : pickRandom(["strong", "weak"] as const);
    const onlineBooking = random() < 0.15;

    const contactSet = buildProceduralContactSet(config);
    const verticalSignals = config.publicSignalsByVertical[vertical] ?? [];
    const publicSignals = allocatePublicSignals(verticalSignals, 3);
    const company: DesignedCompany = {
      companyName,
      vertical,
      locations,
      metro,
      inTerritory: true,
      sizeNote: `${locations} locations`,
      onlineBooking,
      blurb: proceduralBlurb(
        vertical,
        metro,
        globalBlurbBucketPlanner.nextBucket("strong_fit")
      ),
      publicSignals,
      researchFacts: [],
      class: "strong_fit",
      subtype: null,
      fitRank: null,
      triggerQuality,
      keyedTrigger: "Recent location opening",
      bestContact: contactSet.correct.contactName,
      why: "Strong fit on paper but weaker trigger or axis coverage than Summit.",
      contactSet,
    };
    const score = scoreIcpFit(toIcpInput(company));
    const summitPerfect =
      score.axesPassed === 4 && company.triggerQuality === "strong";
    const triggerThemes = countMatchedTriggerThemes(
      company.publicSignals,
      config.targetTriggerSignatureThemes
    );
    if (summitPerfect || triggerThemes > 1) {
      continue;
    }

    globalVerticalBalancer.register(company.vertical);
    return company;
  }

  throw new Error(
    "Could not build secondary strong_fit company. Expand name pools if name allocation failed."
  );
}

/**
 * Creates one pass-class company that fails a visible ICP axis (R3).
 */
function buildPassCompany(
  config: TempoDirectorySeedConfig,
  registry: CompanyNameRegistry,
  forced?: { name: string; vertical: string }
): DesignedCompany {
  const forceName = forced?.name;
  for (let attempt = 0; attempt < GENERATION_RETRY_MAX; attempt += 1) {
    const vertical = forced?.vertical ?? globalVerticalBalancer.pick(config.passVerticalPool);
    const companyName =
      forceName ?? buildUniquePassCompanyName(registry, config, vertical);
    if (!companyName) {
      continue;
    }

    const locations = pickRandom([4, 5, 6, 7, 8]);
    const metro = pickRandom([
      ...config.metroPoolInTerritory,
      ...config.metroPoolOutOfTerritory,
    ]);
    const inTerritory = config.metroPoolInTerritory.includes(metro);
    const passSignals = config.publicSignalsByVertical[vertical] ?? [];

    const company: DesignedCompany = {
      companyName,
      vertical,
      locations,
      metro,
      inTerritory,
      sizeNote: `${locations} locations`,
      onlineBooking: random() < 0.4,
      blurb: proceduralBlurb(
        vertical,
        metro,
        globalBlurbBucketPlanner.nextBucket("pass")
      ),
      publicSignals: allocatePublicSignals(passSignals, 3),
      researchFacts: [],
      class: "pass",
      subtype: null,
      fitRank: null,
      triggerQuality: "none",
      keyedTrigger: null,
      bestContact: null,
      why: "Fails at least one visible ICP axis.",
      contactSet: undefined,
    };

    if (!failsVisibleIcpAxis(toIcpInput(company))) {
      continue;
    }

    if (forceName) {
      if (!registry.tryRegister(forceName)) {
        throw new Error(`Forced pass company name "${forceName}" violates name registry rules.`);
      }
    }

    globalVerticalBalancer.register(company.vertical);
    return company;
  }

  throw new Error(
    "Could not build pass company that fails a visible ICP axis. If retries were exhausted due to names, expand passPrefixPool, passSuffixByVertical, or nameDescriptorPool."
  );
}

/**
 * Subtracts authored counts from the generation plan per class.
 */
export function resolveProceduralCounts(config: TempoDirectorySeedConfig): {
  strong_fit: number;
  near_miss: number;
  trap: number;
  pass: number;
} {
  const authoredByClass = config.authoredCompanies.reduce(
    (acc, company) => {
      acc[company.class] += 1;
      return acc;
    },
    { strong_fit: 0, near_miss: 0, trap: 0, pass: 0 } as Record<CompanyClass, number>
  );

  return {
    strong_fit: Math.max(0, config.generationPlan.strong_fit - authoredByClass.strong_fit),
    near_miss: Math.max(0, config.generationPlan.near_miss - authoredByClass.near_miss),
    trap: Math.max(0, config.generationPlan.trap - authoredByClass.trap),
    pass: Math.max(0, config.generationPlan.pass - authoredByClass.pass),
  };
}

/**
 * Validates target trigger signature isolation and content diversity rules.
 */
export function validateContentQuality(
  companies: DesignedCompany[],
  config: TempoDirectorySeedConfig
): void {
  const target = companies.find((company) => company.fitRank === 1);
  if (!target) {
    throw new Error("Target company with fit_rank 1 not found.");
  }

  for (const company of companies) {
    if (company.fitRank === 1) {
      continue;
    }
    const matchedThemes = countMatchedTriggerThemes(
      company.publicSignals,
      config.targetTriggerSignatureThemes
    );
    if (matchedThemes > 1) {
      throw new Error(
        `Target trigger signature violated: "${company.companyName}" matches ${matchedThemes} signature themes in public_signals.`
      );
    }
  }

  const factViolations = globalFactUsage.violations();
  if (factViolations.length > 0) {
    throw new Error(
      `Fact reuse limit exceeded: ${factViolations
        .map((item) => `"${item.sentence}" (${item.count})`)
        .join("; ")}`
    );
  }

  const signalViolations = globalSignalUsage.violations();
  if (signalViolations.length > 0) {
    throw new Error(
      `Public signal reuse limit exceeded: ${signalViolations
        .map((item) => `"${item.sentence}" (${item.count})`)
        .join("; ")}`
    );
  }

  for (const company of companies) {
    const pool = config.researchFactsByVertical[company.vertical] ?? [];
    const themes = new Set<string>();
    for (const fact of company.researchFacts) {
      const entry = pool.find((item) => item.text.trim() === fact.text.trim());
      if (entry) {
        if (themes.has(entry.theme)) {
          throw new Error(
            `Duplicate fact theme "${entry.theme}" within "${company.companyName}".`
          );
        }
        themes.add(entry.theme);
      }
    }
  }

  for (const company of companies) {
    if (company.class !== "trap" || !company.subtype) {
      continue;
    }
    const subtype = company.subtype as TrapSubtype;
    const disqualifier = company.trapDisqualifierFact;
    if (!disqualifier) {
      throw new Error(`Trap "${company.companyName}" is missing trapDisqualifierFact.`);
    }
    const disqualifierMatches = company.researchFacts.filter(
      (fact) =>
        fact.text.trim() === disqualifier.trim() ||
        factMatchesDisqualifierTheme(fact.text, subtype, config)
    );
    if (disqualifierMatches.length !== 1) {
      throw new Error(
        `Trap "${company.companyName}" has ${disqualifierMatches.length} disqualifier-themed facts (expected 1).`
      );
    }
    const disqualifierIndex = company.researchFacts.findIndex(
      (fact) => fact.text.trim() === disqualifier.trim()
    );
    if (disqualifierIndex === 0) {
      throw new Error(
        `Trap "${company.companyName}" has disqualifier as first research_fact.`
      );
    }
    if (
      !isDisqualifierCapSafe(
        company.researchFacts.slice(0, disqualifierIndex),
        config.disqualifierTopicsBySubtype[subtype]
      )
    ) {
      throw new Error(
        `Trap "${company.companyName}" disqualifier is not shared for "risks", "fit" and each of its own topics (its topics must answer them, and it must be within the first ${MAX_SHARED_FINDINGS} matching findings).`
      );
    }
  }

  const trapDisqualifiers = companies
    .filter((company) => company.class === "trap")
    .map((company) => company.trapDisqualifierFact?.trim().toLowerCase() ?? "");
  const uniqueDisqualifiers = new Set(trapDisqualifiers);
  if (uniqueDisqualifiers.size !== trapDisqualifiers.length) {
    throw new Error("Duplicate trap disqualifier sentence across traps.");
  }

  validateResearchFindings(companies, config);
}

/**
 * Checks the topic config before generation: every fact-pool theme and every trap
 * subtype has 1–2 topics, all from config.factTopics.
 */
export function validateTopicConfig(config: TempoDirectorySeedConfig): void {
  const allowed = new Set(config.factTopics);
  const checkTopics = (label: string, topics: readonly string[] | undefined): void => {
    if (!topics || topics.length < MIN_FINDING_TOPICS || topics.length > MAX_FINDING_TOPICS) {
      throw new Error(
        `${label} needs ${MIN_FINDING_TOPICS}–${MAX_FINDING_TOPICS} topics (got ${topics?.length ?? 0}). Update themeToTopics / disqualifierTopicsBySubtype.`
      );
    }
    const unknown = topics.filter((topic) => !allowed.has(topic));
    if (unknown.length > 0) {
      throw new Error(`${label} has unknown topics: ${unknown.join(", ")}.`);
    }
  };
  for (const pool of Object.values(config.researchFactsByVertical)) {
    for (const entry of pool) {
      checkTopics(`Fact theme "${entry.theme}"`, config.themeToTopics[entry.theme]);
    }
  }
  for (const subtype of TRAP_SUBTYPES) {
    checkTopics(`Disqualifier subtype "${subtype}"`, config.disqualifierTopicsBySubtype[subtype]);
  }
}

/**
 * Final research-finding rules (fails generation): every finding has 1–2 known
 * topics; no finding text (normalized) appears at two companies; no finding repeats
 * its own company's public signals.
 */
export function validateResearchFindings(
  companies: readonly DesignedCompany[],
  config: TempoDirectorySeedConfig
): void {
  const allowed = new Set(config.factTopics);
  const companiesByText = new Map<string, Set<string>>();

  for (const company of companies) {
    for (const finding of company.researchFacts) {
      if (
        finding.topics.length < MIN_FINDING_TOPICS ||
        finding.topics.length > MAX_FINDING_TOPICS ||
        finding.topics.some((topic) => !allowed.has(topic))
      ) {
        throw new Error(
          `Finding "${finding.text}" at "${company.companyName}" has invalid topics [${finding.topics.join(", ")}].`
        );
      }
      if (findingRepeatsSignals(finding.text, company.publicSignals)) {
        throw new Error(
          `Finding "${finding.text}" at "${company.companyName}" repeats the company's public signals.`
        );
      }
      const key = normalizeSentence(finding.text);
      const names = companiesByText.get(key) ?? new Set<string>();
      names.add(company.companyName);
      companiesByText.set(key, names);
    }
  }

  const shared = Array.from(companiesByText.entries()).filter(([, names]) => names.size > 1);
  if (shared.length > 0) {
    throw new Error(
      `Finding text shared by two or more companies: ${shared
        .map(([text, names]) => `"${text}" (${Array.from(names).join(", ")})`)
        .join("; ")}`
    );
  }
}

/**
 * Builds the full 64-company roster from authored + procedural slots.
 */
export function buildCompanyRoster(config: TempoDirectorySeedConfig): DesignedCompany[] {
  validateTopicConfig(config);
  random = mulberry32(config.seed);
  globalFactUsage.reset();
  globalSignalUsage.reset();
  globalTrapDisqualifierAllocator.reset();
  globalBlurbBucketPlanner.reset();
  globalVerticalBalancer.reset();
  globalUsedContactNames.clear();
  const registry = new CompanyNameRegistry();
  for (const company of config.authoredCompanies) {
    registry.registerAuthored(company.companyName);
    globalVerticalBalancer.register(company.vertical);
    globalBlurbBucketPlanner.registerAuthored(company.class, company.blurb);
    if (company.class === "trap" && company.trapDisqualifierFact) {
      globalTrapDisqualifierAllocator.registerAuthored(company.trapDisqualifierFact);
    }
  }
  registerAuthoredSentences(config.authoredCompanies);
  const procedural = resolveProceduralCounts(config);
  // Copies: finalizeResearchFacts replaces researchFacts, which must not change the config
  // (otherwise the next run in the same process starts from this run's output).
  const companies: DesignedCompany[] = config.authoredCompanies.map((company) => ({ ...company }));

  for (let index = 0; index < procedural.strong_fit; index += 1) {
    companies.push(buildSecondaryStrongFit(config, registry));
  }

  const nearMissQueue: NearMissSubtype[] = [];
  while (nearMissQueue.length < procedural.near_miss) {
    for (const subtype of NEAR_MISS_SUBTYPES) {
      if (nearMissQueue.length >= procedural.near_miss) {
        break;
      }
      nearMissQueue.push(subtype);
    }
  }
  const outOfTerritoryCount = nearMissQueue.filter((subtype) => subtype === "out_of_territory")
    .length;
  if (outOfTerritoryCount < 4 && procedural.near_miss >= 4) {
    for (let swap = 0; swap < 4 - outOfTerritoryCount; swap += 1) {
      const replaceIndex = nearMissQueue.findIndex((subtype) => subtype === "no_strain");
      if (replaceIndex >= 0) {
        nearMissQueue[replaceIndex] = "out_of_territory";
      }
    }
  }
  for (const subtype of nearMissQueue) {
    companies.push(buildNearMissCompany(subtype, config, registry));
  }

  const trapQueue: TrapSubtype[] = [];
  while (trapQueue.length < procedural.trap) {
    for (const subtype of TRAP_SUBTYPES) {
      if (trapQueue.length >= procedural.trap) {
        break;
      }
      trapQueue.push(subtype);
    }
  }
  for (const subtype of trapQueue) {
    companies.push(buildTrapCompany(subtype, config, registry));
  }

  for (let index = 0; index < procedural.pass; index += 1) {
    if (index === 0) {
      // The name-collision distractor (shares "Summit" with the target): always retail,
      // so it reads as an obvious outdoor-gear shop, never a random vertical.
      companies.push(buildPassCompany(config, registry, { name: "Summit Outdoor Gear", vertical: "retail" }));
      continue;
    }
    companies.push(buildPassCompany(config, registry));
  }

  registerAuthoredContactNames(companies);
  finalizeResearchFacts(companies, config);
  validateContentQuality(companies, config);
  validateNoStructuralClassCorrelation(companies, config.structuralCorrelation);
  validateNoTemplateDensity(companies, config.templateDensity);
  return companies;
}

/**
 * Validates answer-key rules R1–R6. Throws on hard failures.
 */
export function validateAnswerKey(
  companies: DesignedCompany[],
  warnings: string[]
): void {
  const summit = companies.find((company) => company.fitRank === 1);
  if (!summit || summit.class !== "strong_fit") {
    throw new Error("R1 violated: exactly one strong_fit must have fit_rank 1.");
  }
  const rankOneCount = companies.filter((company) => company.fitRank === 1).length;
  if (rankOneCount !== 1) {
    throw new Error("R1 violated: fit_rank 1 must appear exactly once.");
  }
  if (normalizeCompanyName(summit.companyName) !== normalizeCompanyName("Summit Dental Group")) {
    throw new Error("R1 violated: fit_rank 1 must belong to Summit Dental Group.");
  }

  const summitScore = scoreIcpFit(toIcpInput(summit));
  for (const company of companies) {
    if (company.class !== "strong_fit" || company.fitRank === 1) {
      continue;
    }
    const score = scoreIcpFit(toIcpInput(company));
    const matchesSummit =
      score.axesPassed === summitScore.axesPassed &&
      score.axesPassed === 4 &&
      company.triggerQuality === "strong";
    if (matchesSummit) {
      throw new Error(
        `R2 violated: secondary strong_fit "${company.companyName}" matches Summit on all axes with a strong trigger.`
      );
    }
  }

  for (const company of companies) {
    if (company.class !== "pass") {
      continue;
    }
    if (!failsVisibleIcpAxis(toIcpInput(company))) {
      throw new Error(
        `R3 violated: pass company "${company.companyName}" is in-vertical, in-range, and in-territory.`
      );
    }
  }

  for (const company of companies) {
    if (company.class !== "near_miss") {
      continue;
    }
    const score = scoreIcpFit(toIcpInput(company));
    const defensible =
      score.axesPassed < 4 ||
      company.triggerQuality === "none" ||
      company.triggerQuality === "weak";
    if (!defensible) {
      throw new Error(`R4 violated: near_miss "${company.companyName}" is too strong.`);
    }
  }

  for (const company of companies) {
    if (company.class !== "trap") {
      continue;
    }
    const score = scoreIcpFit(toIcpInput(company));
    const attractive =
      score.axesPassed >= 3 &&
      (company.triggerQuality === "strong" || company.triggerQuality === "weak");
    if (!attractive) {
      throw new Error(`R5 violated: trap "${company.companyName}" is not attractive enough.`);
    }
    if (company.researchFacts.length === 0) {
      throw new Error(`R5 violated: trap "${company.companyName}" has empty research_facts.`);
    }
    if (
      company.researchFacts.length < MIN_RESEARCH_FACTS ||
      company.researchFacts.length > MAX_RESEARCH_FACTS
    ) {
      throw new Error(
        `R5 violated: trap "${company.companyName}" must have ${MIN_RESEARCH_FACTS}–${MAX_RESEARCH_FACTS} research_facts.`
      );
    }
  }

  const normalized = companies.map((company) => normalizeCompanyName(company.companyName));
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw new Error("R6 violated: duplicate company names after normalization.");
  }

  for (const company of companies) {
    if (company.companyName.includes("(") || company.companyName.includes(")")) {
      throw new Error(
        `R6 violated: company name "${company.companyName}" contains a parenthetical qualifier.`
      );
    }
  }

  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left] as string;
      const b = normalized[right] as string;
      if (a.includes(b) || b.includes(a)) {
        throw new Error(
          `R6 violated: normalized company names form a substring pair (${companies[left]?.companyName} / ${companies[right]?.companyName}).`
        );
      }
    }
  }

  const firstWordCounts = new Map<string, number>();
  for (const company of companies) {
    const firstWord = companyFirstWord(company.companyName).toLowerCase();
    firstWordCounts.set(firstWord, (firstWordCounts.get(firstWord) ?? 0) + 1);
  }
  for (const [firstWord, count] of Array.from(firstWordCounts.entries())) {
    if (count > MAX_FIRST_WORD_OCCURRENCES) {
      throw new Error(
        `R6 violated: first word "${firstWord}" appears ${count} times (max ${MAX_FIRST_WORD_OCCURRENCES}).`
      );
    }
  }
  const summitCount = firstWordCounts.get(SUMMIT_FIRST_WORD) ?? 0;
  if (summitCount !== 2) {
    throw new Error(
      `R6 violated: first word "Summit" must appear exactly twice (got ${summitCount}).`
    );
  }

  const factCountsByClass = new Map<CompanyClass, number[]>();
  for (const company of companies) {
    const group = factCountsByClass.get(company.class) ?? [];
    group.push(company.researchFacts.length);
    factCountsByClass.set(company.class, group);
  }
  for (const [companyClass, lengths] of Array.from(factCountsByClass.entries())) {
    if (
      lengths.some(
        (length) => length < MIN_RESEARCH_FACTS || length > MAX_RESEARCH_FACTS
      )
    ) {
      throw new Error(
        `research_facts count for class "${companyClass}" must stay within ${MIN_RESEARCH_FACTS}–${MAX_RESEARCH_FACTS} (got ${lengths.join(", ")}).`
      );
    }
    if (new Set(lengths).size === 1) {
      throw new Error(
        `research_facts count for class "${companyClass}" has no spread (all ${lengths[0]}).`
      );
    }
  }

  if (companies.length !== 64) {
    throw new Error(`Expected 64 companies, received ${companies.length}.`);
  }

  if (
    companies.filter((company) => company.class === "strong_fit").length !== 9 ||
    companies.filter((company) => company.class === "near_miss").length !== 16 ||
    companies.filter((company) => company.class === "trap").length !== 7 ||
    companies.filter((company) => company.class === "pass").length !== 32
  ) {
    throw new Error("Class distribution does not match 9 / 16 / 7 / 32 plan.");
  }

  warnings.push(
    `Validated ${companies.length} companies; Summit fit_rank 1 with ${summitScore.axesPassed}/4 ICP axes and trigger "${summit.triggerQuality}".`
  );
}

/**
 * Maps a designed company to a database insert row.
 */
function toInsertRow(simulationId: string, company: DesignedCompany): DirectoryRowInsert {
  const entryType: EntryType =
    company.fitRank === 1 ? "target" : company.class === "trap" ? "crafted_decoy" : "filler";

  return {
    simulation_id: simulationId,
    company_name: company.companyName,
    industry: verticalToIndustry(company.vertical),
    size_locations: `${company.locations} location${company.locations === 1 ? "" : "s"}`,
    signal_hint: company.publicSignals[0] ?? "",
    hidden_claim: null,
    entry_type: entryType,
    is_active: true,
    in_data_room: true,
    vertical: company.vertical,
    locations: company.locations,
    metro: company.metro,
    in_territory: company.inTerritory,
    size_note: company.sizeNote,
    online_booking: company.onlineBooking,
    blurb: company.blurb,
    public_signals: company.publicSignals,
    research_facts: company.researchFacts,
    class: company.class,
    subtype: company.subtype,
    fit_rank: company.fitRank,
    trigger_quality: company.triggerQuality,
    keyed_trigger: company.keyedTrigger,
    best_contact: company.bestContact,
    why: company.why,
  };
}

function buildDesignedContactRows(
  companyId: string,
  contactSet: DesignedContactSet
): ContactRowInsert[] {
  return [
    {
      company_id: companyId,
      contact_name: contactSet.correct.contactName,
      contact_title: contactSet.correct.contactTitle,
      department: contactSet.correct.department,
      gender: contactSet.correct.gender,
      is_correct_contact: true,
      stronger_axis: null,
      weaker_axis: null,
    },
    ...contactSet.traps.map((trap) => ({
      company_id: companyId,
      contact_name: trap.contactName,
      contact_title: trap.contactTitle,
      department: trap.department,
      gender: trap.gender,
      is_correct_contact: false,
      stronger_axis: trap.strongerAxis,
      weaker_axis: trap.weakerAxis,
    })),
  ];
}

function buildFillerContactRows(companyId: string, config: TempoDirectorySeedConfig): ContactRowInsert[] {
  const contacts = [randomUniquePerson(), randomUniquePerson(), randomUniquePerson()];
  return contacts.map((person, index) => ({
    company_id: companyId,
    contact_name: `${person.firstName} ${person.lastName}`,
    contact_title: pickRandom(config.contactTitlePool),
    department: pickRandom(config.contactDepartmentPool),
    gender: person.gender,
    is_correct_contact: index === 0,
    stronger_axis: null,
    weaker_axis: null,
  }));
}

async function wipeSimulationDirectory(
  supabase: SupabaseClient,
  simulationId: string
): Promise<void> {
  const { data: companies, error } = await supabase
    .from("crm_prospect_directory")
    .select("id")
    .eq("simulation_id", simulationId);

  if (error) {
    throw new Error(`Could not load existing directory rows: ${error.message}`);
  }

  const companyIds = (companies ?? []).map((row) => String(row.id));
  if (companyIds.length === 0) {
    return;
  }

  const { error: deleteContactsError } = await supabase
    .from("crm_prospect_contacts")
    .delete()
    .in("company_id", companyIds);
  if (deleteContactsError) {
    throw new Error(`Could not delete existing contacts: ${deleteContactsError.message}`);
  }

  const { error: deleteCompaniesError } = await supabase
    .from("crm_prospect_directory")
    .delete()
    .eq("simulation_id", simulationId);
  if (deleteCompaniesError) {
    throw new Error(`Could not delete existing directory rows: ${deleteCompaniesError.message}`);
  }
}

/**
 * Wipes and regenerates the Tempo prospect directory for one simulation.
 */
export async function generateProspectDirectory(
  supabase: SupabaseClient,
  config: TempoDirectorySeedConfig
): Promise<{ insertedCompanies: number; insertedContacts: number; report: GenerationReport }> {
  const { error: schemaError } = await supabase
    .from("crm_prospect_directory")
    .select("vertical")
    .limit(1);
  if (schemaError?.message.includes("vertical")) {
    throw new Error(
      "Missing data-room v2 columns. Run supabase/data-room-v2-migration.sql in the Supabase SQL editor first."
    );
  }

  const warnings: string[] = [];
  const companies = buildCompanyRoster(config);
  validateDesignedContactSets(companies, config);
  validateAnswerKey(companies, warnings);

  await wipeSimulationDirectory(supabase, config.simulationId);

  const rows = companies.map((company) => toInsertRow(config.simulationId, company));
  const { data: inserted, error: insertError } = await supabase
    .from("crm_prospect_directory")
    .insert(rows)
    .select("id, company_name, class");

  if (insertError || !inserted) {
    throw new Error(`Insert failed: ${insertError?.message ?? "unknown"}`);
  }

  const designedByName = new Map(
    companies
      .filter((company) => company.contactSet)
      .map((company) => [company.companyName, company.contactSet as DesignedContactSet])
  );

  const contactRows: ContactRowInsert[] = [];
  for (const row of inserted) {
    const contactSet = designedByName.get(String(row.company_name));
    if (contactSet) {
      contactRows.push(...buildDesignedContactRows(String(row.id), contactSet));
      continue;
    }
    contactRows.push(...buildFillerContactRows(String(row.id), config));
  }

  const { error: contactInsertError } = await supabase
    .from("crm_prospect_contacts")
    .insert(contactRows);
  if (contactInsertError) {
    throw new Error(`Contact insert failed: ${contactInsertError.message}`);
  }

  const countsByClass = companies.reduce(
    (acc, company) => {
      acc[company.class] += 1;
      return acc;
    },
    { strong_fit: 0, near_miss: 0, trap: 0, pass: 0 } as Record<CompanyClass, number>
  );
  const countsBySubtype: Record<string, number> = {};
  for (const company of companies) {
    if (!company.subtype) {
      continue;
    }
    countsBySubtype[company.subtype] = (countsBySubtype[company.subtype] ?? 0) + 1;
  }

  return {
    insertedCompanies: inserted.length,
    insertedContacts: contactRows.length,
    report: {
      warnings,
      countsByClass,
      countsBySubtype,
      mostReusedFact: globalFactUsage.mostReused(),
      mostReusedSignal: globalSignalUsage.mostReused(),
      factReuseViolations: globalFactUsage.violations(),
      signalReuseViolations: globalSignalUsage.violations(),
    },
  };
}

function loadEnvLocalIfNeeded(): void {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }
  try {
    const envPath = join(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    /* optional */
  }
}

async function runCli(): Promise<void> {
  loadEnvLocalIfNeeded();
  // The secret seed comes first: without a valid one nothing is built or written.
  const seed = parseDirectorySeed(process.env.TEMPO_DIRECTORY_SEED);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const { tempoDirectorySeed } = await import("./config/tempo-directory-seed");
  const supabase = createClient(url, key);
  const result = await generateProspectDirectory(supabase, { ...tempoDirectorySeed, seed });
  console.log(
    `Done. Inserted ${result.insertedCompanies} company row(s), synced ${result.insertedContacts} contact row(s).`
  );
  console.log("Class counts:", result.report.countsByClass);
  console.log("Subtype counts:", result.report.countsBySubtype);
  for (const warning of result.report.warnings) {
    console.warn(warning);
  }
}

const isMain =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;

if (isMain) {
  runCli().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
