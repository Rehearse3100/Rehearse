/**
 * data-room-research-topics.ts
 * Topic tags for Data Room research findings (simulation-neutral). Every finding
 * stored in crm_prospect_directory.research_facts carries 1–2 fact topics; question
 * topics map to the fact topics that answer them, which the Data Room assistant's
 * router and fact policy use. Read by the directory seed config and generator, the
 * Data Room chat route and modules, the integrity tests and the local eval.
 */

// ── Fact topics ───

/** Topics a research finding can carry (each finding gets 1–2). */
export const FACT_TOPICS = [
  "current_tools",
  "budget",
  "staffing",
  "operations",
  "growth",
  "ownership",
  "customer_feedback",
  "amenities",
] as const;

export type FactTopic = (typeof FACT_TOPICS)[number];

/** What each fact topic covers (the tagging guide). */
export const FACT_TOPIC_DESCRIPTIONS: Record<FactTopic, string> = {
  current_tools: "software, systems, vendors, contracts, recent rollouts",
  budget: "spending, budget, cost pressure, freezes",
  staffing: "hiring, cuts, turnover, team changes",
  operations: "processes, hours, wait times, capacity, how work gets done",
  growth: "new locations, expansion, acquisitions",
  ownership: "owner, franchise, corporate structure, who decides",
  customer_feedback: "reviews, complaints, sentiment",
  amenities: "parking, décor, facilities, events, community activities",
};

// ── Question topics ───

/** Topics a student's question can be about: the fact topics plus three broader ones. */
export const QUESTION_TOPICS = [...FACT_TOPICS, "risks", "fit", "recent_changes"] as const;

export type QuestionTopic = (typeof QUESTION_TOPICS)[number];

/** The fact topics that answer each question topic. */
export const QUESTION_TOPIC_FACT_TOPICS: Record<QuestionTopic, readonly FactTopic[]> = {
  current_tools: ["current_tools"],
  budget: ["budget"],
  staffing: ["staffing"],
  operations: ["operations"],
  growth: ["growth"],
  ownership: ["ownership"],
  customer_feedback: ["customer_feedback"],
  amenities: ["amenities"],
  risks: ["current_tools", "budget", "staffing", "ownership", "operations", "growth"],
  fit: ["operations", "growth", "current_tools", "budget", "staffing", "ownership"],
  recent_changes: ["growth", "current_tools", "staffing", "operations"],
};

// ── Stored shape ───

/** One research finding as stored in research_facts. */
export type ResearchFinding = {
  text: string;
  topics: FactTopic[];
};

const FACT_TOPIC_SET: ReadonlySet<string> = new Set(FACT_TOPICS);

/** True when the value is one of FACT_TOPICS. */
export function isFactTopic(value: unknown): value is FactTopic {
  return typeof value === "string" && FACT_TOPIC_SET.has(value);
}

/**
 * Reads research_facts in either stored shape: the topic-tagged array
 * ([{ text, topics }]) or the older string array (topics left empty). Entries
 * without text, and unknown topics, are dropped.
 */
export function parseResearchFindings(value: unknown): ResearchFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): ResearchFinding[] => {
    if (typeof entry === "string") {
      const text = entry.trim();
      return text ? [{ text, topics: [] }] : [];
    }
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const { text, topics } = entry as { text?: unknown; topics?: unknown };
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) {
      return [];
    }
    return [{ text: trimmed, topics: Array.isArray(topics) ? topics.filter(isFactTopic) : [] }];
  });
}
