/**
 * data-room-chat-policy.ts
 * Code-side fact policy for the Data Room assistant (pure). From the router's
 * decision (lib/data-room-chat-router.ts) it decides which facts may be shown for
 * each company in scope. Research findings are allowed only for a specific research
 * question about exactly one company, only when their topics answer the question's
 * topic, in stored order — at most 4 for a broad topic (risks, fit, recent
 * changes), every match for a single fact topic; allowed findings are shown as they
 * are, and findings that aren't allowed never reach the model or the student.
 * Off-topic questions get a fixed reply. Used by POST /api/student/data-room-chat,
 * the directory generator (trap placement) and the local eval.
 */

import {
  QUESTION_TOPIC_FACT_TOPICS,
  type QuestionTopic,
  type ResearchFinding,
} from "@/lib/data-room-research-topics";
import type { ChatScope } from "@/lib/data-room-chat-scope";
import { scopeKindOf, type RouterIntent } from "@/lib/data-room-chat-router";

/** Fixed reply to an off-topic question (no facts, no further model call). */
export const OFF_TOPIC_REPLY = "I can only help with researching these companies.";

/** Most research findings shared for one broad question topic. */
export const MAX_SHARED_FINDINGS = 4;

/** Question topics that span several fact topics: their findings are capped at MAX_SHARED_FINDINGS. */
export const BROAD_QUESTION_TOPICS: readonly QuestionTopic[] = ["risks", "fit", "recent_changes"];

export type PolicyCompany = {
  id: string;
  /** The company's research findings in stored order. */
  findings: readonly ResearchFinding[];
};

export type CompanyAllowance = {
  /** Whether the company's public facts (card, signals, contacts) may be used. */
  public: boolean;
  /** The research findings that may be offered and shown (usually none). */
  hidden: ResearchFinding[];
};

export type AllowedFacts = {
  /** A fixed reply instead of an answer (off-topic questions); null otherwise. */
  reply: string | null;
  companies: Record<string, CompanyAllowance>;
};

export type PolicyInput = {
  intent: RouterIntent;
  topic: QuestionTopic | null;
  scope: ChatScope;
  companies: readonly PolicyCompany[];
};

/**
 * The facts allowed for the answer, per company:
 * - off_topic → no facts and OFF_TOPIC_REPLY;
 * - specific_research about exactly one company → public facts plus the findings
 *   (stored order) whose topics answer the question's topic: the first 4 for a
 *   broad topic (risks, fit, recent_changes), every one for a single fact topic;
 * - everything else (overview, attribute_lookup, compare, filter_list, and
 *   meta_or_bulk, which is answered as an overview) → public facts only.
 */
export function allowedFacts(input: PolicyInput): AllowedFacts {
  if (input.intent === "off_topic") {
    return {
      reply: OFF_TOPIC_REPLY,
      companies: Object.fromEntries(
        input.companies.map((company) => [company.id, { public: false, hidden: [] }])
      ),
    };
  }

  const answeringTopics =
    input.intent === "specific_research" &&
    input.topic !== null &&
    scopeKindOf(input.scope) === "one" &&
    input.companies.length === 1
      ? new Set<string>(QUESTION_TOPIC_FACT_TOPICS[input.topic])
      : null;
  const cap =
    input.topic !== null && BROAD_QUESTION_TOPICS.includes(input.topic) ? MAX_SHARED_FINDINGS : Infinity;

  return {
    reply: null,
    companies: Object.fromEntries(
      input.companies.map((company) => [
        company.id,
        {
          public: true,
          hidden: answeringTopics
            ? company.findings
                .filter((finding) => finding.topics.some((topic) => answeringTopics.has(topic)))
                .slice(0, cap)
            : [],
        },
      ])
    ),
  };
}
