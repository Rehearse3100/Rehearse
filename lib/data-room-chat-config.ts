/**
 * data-room-chat-config.ts
 * Per-simulation settings for the Data Room chat, in one place: the fields All
 * companies mode filters by (as the fixed replies, the greeting and the switch's
 * hint word them, and as a partial answer names the ones it applied), what the
 * greeting suggests asking about, the result and compare tables' labels, the tags
 * before research findings and public signals in an answer, what each
 * research topic covers (the router's topic list), the plain labels the fixed first
 * lines use for a card detail or a research topic, the research a partial
 * All-companies answer says it can't search, and the model settings of the chat's
 * three calls (router, selection, opening; lib/data-room-chat-models.ts builds each
 * request from them). getDataRoomChatConfig(simulationId) returns a simulation's
 * config; Tempo is the only one, and the default, so a future simulation only adds
 * its own entry. The chat code (lib/data-room-chat-*.ts, the chat route,
 * ProspectingDataRoomChat and DataRoomChatAnswer) builds its strings from this. Also
 * the transcript's storage key prefix (shared with the restart clean-up in
 * lib/tempo-prospecting.ts).
 */

import { TEMPO_SIMULATION_ID } from "@/lib/constants";
import type { FilterField } from "@/lib/data-room-chat-filter";
import type { RouterAttribute } from "@/lib/data-room-chat-router";
import type { CompareRowKey } from "@/lib/data-room-chat-scope";
import type { QuestionTopic } from "@/lib/data-room-research-topics";

/**
 * Data Room AI assistant transcript key (one per attempt: prefix + attempt id). It
 * lives in localStorage until Restart clears it; earlier versions used
 * sessionStorage. The value stays as it is so saved chats keep loading.
 */
export const DATA_ROOM_CHAT_STORAGE_PREFIX = "tempo-data-room-chat-v2-";

// ── Model settings ───

/** The reasoning efforts a Chat Completions request can name (the OpenAI SDK's ReasoningEffort, without null). */
export type DataRoomChatReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * One call's model settings. reasoningEffort and temperature are sent only when set.
 * tokenLimitParam names the output cap's parameter: "max_tokens" (the default, as
 * before) or "max_completion_tokens", for a model that rejects max_tokens, so that
 * switch is a settings change too.
 */
export type DataRoomChatModelSetting = {
  model: string;
  reasoningEffort?: DataRoomChatReasoningEffort;
  temperature?: number;
  tokenLimitParam?: "max_tokens" | "max_completion_tokens";
};

/** The chat's three model calls: the router, the selection call and the opening call. */
export type DataRoomChatModels = {
  router: DataRoomChatModelSetting;
  selection: DataRoomChatModelSetting;
  opening: DataRoomChatModelSetting;
};

// ── Wording ───

export type DataRoomChatConfig = {
  /**
   * The fields All companies mode filters by, in order: how the replies name each one
   * (label) and how the switch's hint line does (shortLabel).
   */
  filterFields: ReadonlyArray<{ label: string; shortLabel: string }>;
  /** What the greeting suggests asking about the open company ("its locations, software, …"). */
  greetingTopics: readonly string[];
  /** The result table's column headers. */
  tableHeaders: { company: string; industry: string; locations: string; city: string };
  /** The compare table's row labels. */
  compareRowLabels: Readonly<Record<CompareRowKey, string>>;
  /** Territory and online-booking wording: the result table's tags and the compare table's Territory cell. */
  cardLabels: { inTerritory: string; outOfTerritory: string; onlineBooking: string; noOnlineBooking: string };
  /** The small tags before a research finding and a public signal in an answer (card facts get none). */
  lineSourceTags: { research: string; public: string };
  /** What each question topic covers, for the router's topic list (the fact topics, then the broad ones). */
  topicDescriptions: Readonly<Record<QuestionTopic, string>>;
  /** Each filter field in plain words, for a partial All-companies answer's count line ("… (industry and state)."). */
  appliedFilterLabels: Readonly<Record<FilterField, string>>;
  /** Research a partial All-companies answer says it can't search ("software, budget or risks"). */
  unfilteredResearchExamples: readonly string[];
  /** Each card detail in plain words, for the fixed first line "Here's what's on record for {label}." */
  attributeLabels: Readonly<Record<RouterAttribute, string>>;
  /** Each question topic in plain words, for the fixed first line "Here's what's publicly findable about {label}." */
  topicLabels: Readonly<Record<QuestionTopic, string>>;
  /** The router's, the selection call's and the opening call's model settings. */
  models: DataRoomChatModels;
};

/** Tempo (Sell Tempo to Summit Dental Group). */
const TEMPO_DATA_ROOM_CHAT_CONFIG: DataRoomChatConfig = {
  filterFields: [
    { label: "industry", shortLabel: "industry" },
    { label: "city or state", shortLabel: "city or state" },
    { label: "number of locations", shortLabel: "locations" },
    { label: "territory", shortLabel: "territory" },
    { label: "online booking", shortLabel: "online booking" },
  ],
  greetingTopics: ["locations", "software", "hiring", "budget", "risks"],
  tableHeaders: { company: "Company", industry: "Industry", locations: "Loc", city: "City" },
  compareRowLabels: {
    industry: "Industry",
    locations: "Locations",
    city: "City",
    territory: "Territory",
    online_booking: "Online booking",
    signals: "Signals",
  },
  cardLabels: {
    inTerritory: "In territory",
    outOfTerritory: "Out of territory",
    onlineBooking: "Online booking",
    noOnlineBooking: "No online booking",
  },
  lineSourceTags: { research: "Research", public: "Public" },
  topicDescriptions: {
    current_tools: "software, systems, vendors, contracts, recent rollouts",
    budget: "spending, budget, cost pressure, freezes",
    staffing: "hiring, cuts, turnover, team changes, front-desk staffing",
    operations: "processes, hours, scheduling, phones, wait times, capacity",
    growth: "new locations, expansion, acquisitions",
    ownership: "owner, franchise, corporate structure, who decides",
    customer_feedback: "reviews, complaints, sentiment",
    amenities: "parking, décor, facilities, events, community activities",
    risks: "risks, concerns, red flags, challenges",
    fit: "whether or why they would be a good or bad prospect",
    recent_changes: "what changed recently",
  },
  appliedFilterLabels: {
    industry: "industry",
    metro: "city",
    state: "state",
    locations: "number of locations",
    territory: "territory",
    online_booking: "online booking",
  },
  unfilteredResearchExamples: ["software", "budget", "risks"],
  attributeLabels: {
    industry: "industry",
    locations: "number of locations",
    metro: "city",
    territory: "territory",
    online_booking: "online booking",
    size: "size",
    contacts: "contacts",
  },
  topicLabels: {
    current_tools: "software and tools",
    budget: "budget",
    staffing: "staffing",
    operations: "operations",
    growth: "growth",
    ownership: "ownership and who decides",
    customer_feedback: "customer feedback",
    amenities: "amenities",
    risks: "risks",
    fit: "fit",
    recent_changes: "recent changes",
  },
  // gpt-4o and gpt-4.1-mini shut down on 2027-01-14. gpt-6-luna's model page lists
  // reasoning effort "none" for Chat Completions; no temperature is sent. It rejects
  // max_tokens (confirmed live 2026-11-07: "Use 'max_completion_tokens' instead."), so
  // the output cap goes under max_completion_tokens.
  models: {
    router: { model: "gpt-6-luna", reasoningEffort: "none", tokenLimitParam: "max_completion_tokens" },
    selection: { model: "gpt-6-luna", reasoningEffort: "none", tokenLimitParam: "max_completion_tokens" },
    opening: { model: "gpt-6-luna", reasoningEffort: "none", tokenLimitParam: "max_completion_tokens" },
  },
};

/** Each simulation's config, by simulation id. */
const DATA_ROOM_CHAT_CONFIGS: Readonly<Record<string, DataRoomChatConfig>> = {
  [TEMPO_SIMULATION_ID]: TEMPO_DATA_ROOM_CHAT_CONFIG,
};

/**
 * The Data Room chat config for a simulation; Tempo's for an unknown or missing id
 * (the only simulation for now).
 */
export function getDataRoomChatConfig(simulationId?: string | null): DataRoomChatConfig {
  return (simulationId ? DATA_ROOM_CHAT_CONFIGS[simulationId] : undefined) ?? TEMPO_DATA_ROOM_CHAT_CONFIG;
}

/** "a, b and c" / "a, b or c" (no comma before the last one). */
export function joinList(items: readonly string[], conjunction: "and" | "or"): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

/**
 * The filterable fields as one phrase: the replies' wording ("industry, city or
 * state, number of locations, territory and online booking") or the switch hint's
 * ("industry, city or state, locations, territory or online booking").
 */
export function filterFieldsPhrase(config: DataRoomChatConfig, style: "reply" | "hint"): string {
  return style === "reply"
    ? joinList(
        config.filterFields.map((field) => field.label),
        "and"
      )
    : joinList(
        config.filterFields.map((field) => field.shortLabel),
        "or"
      );
}
