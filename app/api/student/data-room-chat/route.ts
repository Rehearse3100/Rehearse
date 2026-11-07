/**
 * data-room-chat/route.ts
 * POST — Data Room AI Research Assistant, extractive: every answer is rendered by
 * code from stored facts; the model never writes a fact. The only model-written text
 * is a one-sentence opening, written last by its own call from the question, its
 * topic and the finished answer text only (companies as "Company 1", "Company 2"…),
 * checked by code (it may only restate what the facts shown say). Every answer with
 * facts gets exactly one first line (withFirstLine): its own fixed line when it has
 * one (an All-companies list's count line, the exact-detail line, the "nothing
 * hidden" line, the related-findings line, the follow-up line, a limited compare's
 * line), else the checked opening, else — when the call fails or a check drops the
 * sentence — a fixed line built by code (fallbackFirstLine; no retry). The three
 * model calls (router, selection, opening) are built from the simulation's model
 * settings (lib/data-room-chat-config.ts models, lib/data-room-chat-models.ts); the
 * optional server variable DATA_ROOM_CHAT_MODEL replaces the model for all three
 * (never logged). The client sends a scope (1–3 company ids, or all companies) and
 * the question; facts are loaded server-side. Before anything else, every question
 * passes the safety checks (lib/data-room-chat-guard.ts), each refusal a fixed reply:
 * over 500 characters; the attempt's message limits (not in tester mode; fail open);
 * then it is counted; OpenAI moderation (self-harm or other flags; errors carry on);
 * mostly non-Latin letters; and the router's own "not English" verdict. Flow: an
 * unselected-company mention → a server reply (code, against the live roster);
 * otherwise a router call (lib/data-room-chat-router.ts; sees only the redacted
 * question, recent questions and scope kind) labels the question; an "inappropriate"
 * label gets the moderation reply; a "not English" label is ignored when the message
 * holds two common English function words (typos). Small talk (greeting, thanks, how
 * are you, acknowledgement, goodbye) gets its fixed reply, and a question about
 * company names is answered from the roster (the question's scope, every match A–Z),
 * in both modes. The router also rewrites the question to stand on its own; when
 * the rewrite passes the checks (acceptedStandaloneQuestion) the selection and
 * opening calls get it instead of the question as asked, and a follow-up
 * (is_follow_up) about the same 1–3 companies that brings back only lines the last
 * answer showed starts with "That's everything publicly findable on this." A
 * "compare …", "side by side" or "vs" question about 2–3 companies is a compare
 * (only the rows it names, if any; a limited compare starts with the fixed compare
 * line). All companies: no model picks or reads company data — the question's
 * validated conditions (no limit) run over the roster in code and every match is
 * listed under the count line; a question that also asks for something no filter can
 * express gets the list for what could be applied, a count line naming those fields
 * and a fixed note; a count question with no conditions gets the roster total; an
 * answer-key question its own reply; anything else a fixed reply
 * (lib/data-room-chat-filter.ts); a list can be sorted by locations or name, and
 * "give this again, by locations" re-sorts the previous list's companies (all its
 * conditions kept). An answer-key question about open companies gets the public
 * overview under "I can't share hidden or internal information. Here's what's
 * public:". One to three companies: the code-side policy
 * (lib/data-room-chat-policy.ts) decides which facts are allowed; overview, compare
 * and attribute questions are rendered with no further model call; specific
 * research and filter questions show every finding the policy allowed (stored order)
 * plus the public facts one selection call picks — it sees the allowed findings and
 * the public facts, returns fact ids (checked against the facts it was given; it
 * can't add or remove a finding) and whether one states the exact detail asked. When
 * the router says the question asks for one exact detail and no fact states it, the
 * answer starts with "That exact detail isn't publicly findable. Related facts:"
 * (also above a contacts line, which never holds emails or phone numbers). When
 * findings are shown but the selection call replies that no fact answers a narrow
 * question, they stay as they are under "Nothing specific on that is publicly
 * findable. Related findings:"; never on a broad topic (risks, fit, recent changes).
 * A research question about 2–3 companies adds the note "Ask about one company at a
 * time to see its research findings.". Everything is rendered from the stored text
 * (lib/data-room-chat-render.ts), each line with its source (research, public or
 * card) for the pane's tags. Company names in answers come from the database; the
 * model sees companies only as refs ([C1]…). The simulation's wording comes from
 * lib/data-room-chat-config.ts (getDataRoomChatConfig). For the pane's tables, an
 * All-companies list also carries each company's card values (layout "table") and a
 * compare answer card values and signals (layout "compare"); a filter question about
 * one company, or one starting "which ones / which of them / which companies", adds
 * suggestAllCompanies (the pane offers "Search all companies").
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import {
  getDataRoomChatConfig,
  type DataRoomChatConfig,
  type DataRoomChatModelSetting,
} from "@/lib/data-room-chat-config";
import {
  answerAllCompanies,
  parsePreviousListIds,
  refersToPreviousList,
  type FilterCompany,
} from "@/lib/data-room-chat-filter";
import { chatRequestSettings, resolveChatModels } from "@/lib/data-room-chat-models";
import { allowedFacts, BROAD_QUESTION_TOPICS } from "@/lib/data-room-chat-policy";
import {
  allowedFindings,
  allowedPublicFacts,
  answerPathFor,
  attributeLines,
  buildCompanyFacts,
  buildOpeningMessages,
  buildSelectionMessages,
  checkOpening,
  compareRowsFor,
  factLine,
  fallbackFirstLine,
  hasFacts,
  isNoFactAnswersReply,
  needsOpening,
  ONE_COMPANY_RESEARCH_NOTE,
  openingRejection,
  overviewLines,
  parseOpening,
  parseSelection,
  renderAnswer,
  toSelectableFacts,
  withExactDetailIntro,
  withFirstLine,
  withNothingNewIntro,
  withCompareLayout,
  withRelatedFindingsIntro,
  type CompanyBlock,
  type CompanyFacts,
  type CompanyFactSource,
  type SelectableFact,
  type Selection,
} from "@/lib/data-room-chat-render";
import {
  checkUsageLimits,
  guardReply,
  isMostlyNonLatin,
  isTooLong,
  moderateMessage,
  recordUsage,
} from "@/lib/data-room-chat-guard";
import {
  acceptedStandaloneQuestion,
  buildRouterMessages,
  greetingKindOf,
  hasEnglishFunctionWords,
  isCompareRequest,
  isWhichOnesQuestion,
  OVERVIEW_DECISION,
  parseFollowUpContext,
  parseRouterEnglish,
  parseRouterReply,
  replaceRefs,
  scopeKindOf,
  toNameQuery,
  type RouterDecision,
  type ScopeKind,
} from "@/lib/data-room-chat-router";
import {
  answerNameQuery,
  buildOutOfScopeMessage,
  buildRefLabels,
  buildScopeIndex,
  findOutOfScopeMentions,
  firstWordAsWritten,
  greetingReply,
  META_PUBLIC_INTRO,
  parseChatScope,
  parseHistoryQuestions,
  redactCompanyMentions,
  type ChatScope,
  type FirstWordReplacement,
  type NameQueryCompany,
  type ScopeIndex,
  type ScopedAnswer,
} from "@/lib/data-room-chat-scope";
import { createServiceClient } from "@/lib/supabase/server";
import { parseResearchFindings } from "@/lib/data-room-research-topics";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";

type DataRoomChatBody = {
  attemptId?: unknown;
  scope?: unknown;
  history?: unknown;
  newMessage?: unknown;
};

type RosterCompany = {
  id: string;
  company_name: string;
  industry: string | null;
  vertical: string | null;
  locations: number | null;
  metro: string | null;
  in_territory: boolean | null;
  size_note: string | null;
  online_booking: boolean | null;
  blurb: string | null;
  public_signals: unknown;
};

/** One company in scope: its name from the database, its stored values and its facts. */
type ScopedCompany = { id: string; name: string; source: CompanyFactSource; facts: CompanyFacts };

/** Visible-layer roster columns (never answer-key or hidden-layer fields). */
const ROSTER_COLUMNS =
  "id, company_name, industry, vertical, locations, metro, in_territory, size_note, online_booking, blurb, public_signals";

/**
 * Room for the router's whole JSON reply: the decision, any number of All-companies
 * filters, a sort, the rewritten question, and the english / exact_value /
 * confidence fields. Too little cuts the JSON off, and a cut-off reply silently
 * falls back to the overview.
 */
const ROUTER_MAX_TOKENS = 600;
/** Room for every fact id of up to three companies. */
const SELECTION_MAX_TOKENS = 500;
/** Room for one sentence of at most 30 words, in JSON. */
const OPENING_MAX_TOKENS = 100;

/** Router labels a compare request about 2–3 companies replaces (never meta, off-topic or refused). */
const COMPARE_OVERRIDABLE_INTENTS: ReadonlySet<RouterDecision["intent"]> = new Set<RouterDecision["intent"]>([
  "overview",
  "attribute_lookup",
  "specific_research",
  "filter_list",
]);

/** A broad question topic (risks, fit, recent changes): the policy's list, whose findings it caps. */
function isBroadTopic(topic: RouterDecision["topic"]): boolean {
  return topic !== null && BROAD_QUESTION_TOPICS.includes(topic);
}

/**
 * Parses a jsonb string array defensively.
 */
function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** The roster fields a list answer (name question or All-companies filter) reads. */
function toListCompany(row: RosterCompany): FilterCompany {
  return {
    id: String(row.id),
    name: String(row.company_name ?? ""),
    industry: String(row.industry ?? ""),
    locations: typeof row.locations === "number" ? row.locations : null,
    metro: row.metro,
    inTerritory: typeof row.in_territory === "boolean" ? row.in_territory : null,
    onlineBooking: typeof row.online_booking === "boolean" ? row.online_booking : null,
  };
}

/**
 * Redacts names in the student's text: companies in scope become their ref, other
 * companies "another company". A first word shared by two in-scope companies is
 * left as typed.
 */
function redactStudentText(
  text: string,
  index: ScopeIndex,
  refLabels: ReadonlyMap<string, string>
): string {
  const firstWords: FirstWordReplacement[] = [];
  index.firstWordIds.forEach((ids, word) => {
    const inScope = ids.filter((id) => refLabels.has(id));
    if (inScope.length === 1) {
      firstWords.push({ word, replacement: `[${refLabels.get(inScope[0] ?? "")}]`, caseSensitive: false });
    } else if (inScope.length === 0) {
      firstWords.push({ word, replacement: "another company", caseSensitive: false });
    }
  });
  return redactCompanyMentions(
    text,
    index,
    (companyId) => {
      const ref = refLabels.get(companyId);
      return ref ? `[${ref}]` : "another company";
    },
    firstWords
  );
}

/**
 * Redacts a company's fact text for the selection call: its own name (and first
 * word) becomes "the company", other companies "another company". The answer
 * itself is rendered from the stored text.
 */
function redactFactText(text: string, index: ScopeIndex, company: ScopedCompany): string {
  const ownFirstWord = firstWordAsWritten(company.name);
  return redactCompanyMentions(
    text,
    index,
    (companyId) => (companyId === company.id ? "the company" : "another company"),
    ownFirstWord ? [{ word: ownFirstWord, replacement: "the company", caseSensitive: true }] : []
  );
}

/**
 * The fixed answer to small talk (its kind's reply) or to a question about company
 * names (from the roster: the question's scope, every match A–Z; a ref in the value
 * becomes that company's name), or null for any other decision. No model call.
 */
function smallTalkOrNamesAnswer(
  decision: RouterDecision,
  scope: ChatScope,
  config: DataRoomChatConfig,
  scopedCompanies: readonly NameQueryCompany[]
): ScopedAnswer | null {
  if (decision.intent === "small_talk") {
    return greetingReply(greetingKindOf(decision.smallTalkKind), scope, config);
  }
  if (decision.intent === "name_query" && decision.nameMatch) {
    return answerNameQuery(
      toNameQuery(
        decision.nameMatch,
        scopedCompanies.map((company) => company.name)
      ),
      scopedCompanies
    );
  }
  return null;
}

/**
 * The router call (its model settings, JSON). It sees only the redacted question,
 * recent questions and scope kind. Any failure counts as an overview (public facts
 * only) in English. english is false only when the router says so with high confidence.
 */
async function classifyQuestion(
  openai: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  scopeKind: ScopeKind,
  setting: DataRoomChatModelSetting
): Promise<{ decision: RouterDecision; english: boolean }> {
  try {
    const response = await openai.chat.completions.create({
      ...chatRequestSettings(setting, ROUTER_MAX_TOKENS),
      messages,
    });
    const content = response.choices[0]?.message?.content;
    return { decision: parseRouterReply(content, scopeKind), english: parseRouterEnglish(content) };
  } catch (error) {
    console.error("[data-room-chat] router:", error);
    return { decision: OVERVIEW_DECISION, english: true };
  }
}

/**
 * One selection call (its model settings, JSON): the redacted question (the checked
 * rewrite when there is one) and the allowed facts in; fact ids and whether one
 * states the exact detail out (only ids among the given facts are kept), plus whether
 * its reply was the prompt's "no fact answers the question" reply
 * (isNoFactAnswersReply; false when there was no call).
 */
async function selectFacts(
  openai: OpenAI,
  question: string,
  facts: SelectableFact[],
  setting: DataRoomChatModelSetting
): Promise<Selection & { saysNoFactAnswers: boolean }> {
  if (facts.length === 0) {
    return { facts: [], exactAnswer: false, saysNoFactAnswers: false };
  }
  const response = await openai.chat.completions.create({
    ...chatRequestSettings(setting, SELECTION_MAX_TOKENS),
    messages: buildSelectionMessages(question, facts),
  });
  const content = response.choices[0]?.message?.content;
  return { ...parseSelection(content, facts), saysNoFactAnswers: isNoFactAnswersReply(content) };
}

/**
 * The answer's first line, decided once it is final (withFirstLine): an answer with
 * no facts or with its own first line goes out as it is, with no call. Otherwise one
 * opening call (its model settings, JSON) sees the question (question.prompt: the
 * checked rewrite, refs as names, or the message as typed), its topic and the answer
 * text the student will see (companies as "Company 1"…); its sentence goes above the
 * answer if it passes the checks, which read only the student's own words
 * (question.asked), so a name the rewrite filled in never counts as one the student
 * used. A failed call or a dropped sentence gets the fixed line for the answer's path
 * instead (fallbackFirstLine; no retry); a dropped or missing sentence logs which
 * check it failed, or "empty", never the sentence.
 */
async function withAnswerFirstLine(
  openai: OpenAI,
  question: { prompt: string; asked: string },
  decision: RouterDecision,
  answer: ScopedAnswer,
  index: ScopeIndex,
  setting: DataRoomChatModelSetting,
  config: DataRoomChatConfig
): Promise<ScopedAnswer> {
  if (!needsOpening(answer)) {
    return answer;
  }
  const fallback = fallbackFirstLine(decision, answer, config);
  try {
    const response = await openai.chat.completions.create({
      ...chatRequestSettings(setting, OPENING_MAX_TOKENS),
      messages: buildOpeningMessages(question.prompt, answer, index, decision.topic),
    });
    const opening = parseOpening(response.choices[0]?.message?.content);
    // Every missing opening leaves a reason in the log ("empty": the reply held no sentence).
    const rejection = openingRejection(opening, question.asked, answer, index);
    if (rejection) {
      console.info("[data-room-chat] opening dropped:", rejection);
    }
    return withFirstLine(answer, checkOpening(opening, question.asked, answer, index), fallback);
  } catch (error) {
    console.error("[data-room-chat] opening:", error);
    return withFirstLine(answer, null, fallback);
  }
}

/**
 * POST /api/student/data-room-chat
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as DataRoomChatBody;
    const attemptId =
      typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    const newMessage =
      typeof body.newMessage === "string" ? body.newMessage.trim() : "";
    const scope = parseChatScope(body.scope);

    if (!attemptId || !newMessage) {
      return NextResponse.json(
        { error: "attemptId and newMessage are required." },
        { status: 400 }
      );
    }

    // ── Safety checks (lib/data-room-chat-guard.ts), before the answer pipeline ───
    // 1. Length: refused without a model call, not counted.
    if (isTooLong(newMessage)) {
      return NextResponse.json(guardReply("tooLong"));
    }

    if (!scope) {
      return NextResponse.json(
        { error: "Ask about 1 to 3 companies, or turn on All companies." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured." },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id, simulation_id")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .maybeSingle();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    // 2. Limits (not in tester mode): refused replies are not counted; fails open.
    if (!isGateBypassEnabled()) {
      const limit = await checkUsageLimits(supabase, attemptId);
      if (limit) {
        return NextResponse.json(guardReply(limit));
      }
    }
    // 3. Count it.
    await recordUsage(supabase, attemptId, auth.session.studentId);
    // 4. Moderation on the message only; errors carry on.
    const openai = new OpenAI({ apiKey });
    const moderation = await moderateMessage(openai, newMessage);
    if (moderation) {
      return NextResponse.json(guardReply(moderation));
    }
    // 5. English: mostly non-Latin letters are refused before the router (which
    // also says whether the question is English; checked where it runs below).
    if (isMostlyNonLatin(newMessage)) {
      return NextResponse.json(guardReply("notEnglish"));
    }

    const simulationId = String(attempt.simulation_id);
    // The simulation's wording for fixed replies and the router's topics.
    const chatConfig = getDataRoomChatConfig(simulationId);
    // The three calls' model settings; DATA_ROOM_CHAT_MODEL (optional, never logged)
    // swaps the model of all three for the private eval.
    const models = resolveChatModels(chatConfig.models, process.env.DATA_ROOM_CHAT_MODEL);

    // The whole roster: scope check, name redaction, and (for All companies) the facts.
    const { data: rosterRows, error: rosterError } = await supabase
      .from("crm_prospect_directory")
      .select(ROSTER_COLUMNS)
      .eq("simulation_id", simulationId)
      .eq("in_data_room", true)
      .eq("is_active", true)
      .order("company_name", { ascending: true });

    if (rosterError) {
      console.error("[data-room-chat] roster", rosterError);
      return NextResponse.json(
        { error: "Could not verify attached companies." },
        { status: 500 }
      );
    }

    const roster = (rosterRows ?? []) as RosterCompany[];
    const rosterById = new Map(roster.map((row) => [String(row.id), row]));
    const scopedIds =
      scope.mode === "all" ? roster.map((row) => String(row.id)) : scope.companyIds;

    if (scope.mode === "companies" && scope.companyIds.some((id) => !rosterById.has(id))) {
      return NextResponse.json(
        { error: "One or more company IDs are not in this simulation's Data Room roster." },
        { status: 400 }
      );
    }

    const index = buildScopeIndex(
      roster.map((row) => ({
        id: String(row.id),
        name: String(row.company_name ?? ""),
        industry: String(row.industry ?? ""),
      }))
    );

    // A question about an unselected company gets a fixed reply; the model is not called.
    if (scope.mode === "companies") {
      const mention = findOutOfScopeMentions(index, newMessage, scope.companyIds);
      if (mention) {
        const reply: ScopedAnswer = { intro: buildOutOfScopeMessage(mention), items: [] };
        return NextResponse.json(reply);
      }
    }

    const singleCompanyId =
      scope.mode === "companies" && scope.companyIds.length === 1 ? scope.companyIds[0] : null;
    const refLabels = buildRefLabels(scopedIds);
    // The companies in scope, in ref order (C1 first): name questions search these, and
    // a ref the router wrote maps back to its name.
    const scopedCompanies = scopedIds.flatMap((id) => {
      const row = rosterById.get(id);
      return row ? [toListCompany(row)] : [];
    });

    const question = redactStudentText(newMessage, index, refLabels);

    // The router never sees facts or company data.
    const scopeKind = scopeKindOf(scope);
    const routerMessages = buildRouterMessages(
      {
        question,
        recentQuestions: parseHistoryQuestions(body.history).map((text) => redactStudentText(text, index, refLabels)),
        scopeKind,
      },
      chatConfig
    );

    // All companies: the question's validated conditions run over the roster in code
    // (every match, from the database, under the count line); a count question with
    // no conditions gets the roster total; anything else a fixed reply. No opening
    // call: every All-companies answer has its own first line.
    if (scope.mode === "all") {
      const { decision, english } = await classifyQuestion(openai, routerMessages, scopeKind, models.router);
      // Two common English function words make it English whatever the router says (typos).
      if (!english && !hasEnglishFunctionWords(newMessage)) {
        return NextResponse.json(guardReply("notEnglish"));
      }
      if (decision.intent === "inappropriate") {
        return NextResponse.json(guardReply("flagged"));
      }
      // Small talk: its fixed reply. Company names: answered from the roster.
      const fixed = smallTalkOrNamesAnswer(decision, scope, chatConfig, scopedCompanies);
      if (fixed) {
        return NextResponse.json(fixed);
      }
      // "Give this again, by locations": the previous list's companies (every one of
      // its conditions), re-sorted; only when the question points back at that list.
      const previousListIds = refersToPreviousList(newMessage) ? parsePreviousListIds(body.history) : [];
      return NextResponse.json(answerAllCompanies(decision, roster.map(toListCompany), previousListIds, chatConfig));
    }

    // One to three companies: the router runs alongside the data loads.
    const [{ decision: routed, english }, researchResult, contactsResult] = await Promise.all([
      classifyQuestion(openai, routerMessages, scopeKind, models.router),
      singleCompanyId
        ? supabase
            .from("crm_prospect_directory")
            .select("research_facts")
            .eq("id", singleCompanyId)
            .eq("simulation_id", simulationId)
            .maybeSingle()
        : null,
      supabase
        .from("crm_prospect_contacts")
        .select("company_id, contact_name, contact_title, department")
        .in("company_id", scopedIds),
    ]);

    // The router says the question isn't in English (high confidence): fixed reply,
    // unless two common English function words show it is English with typos.
    if (!english && !hasEnglishFunctionWords(newMessage)) {
      return NextResponse.json(guardReply("notEnglish"));
    }
    // Inappropriate (sexual or romantic, looks, someone's personal life, insults):
    // the moderation reply, with no research and no opening.
    if (routed.intent === "inappropriate") {
      return NextResponse.json(guardReply("flagged"));
    }
    // Small talk: its fixed reply. Company names: answered from the roster (these companies).
    const fixed = smallTalkOrNamesAnswer(routed, scope, chatConfig, scopedCompanies);
    if (fixed) {
      return NextResponse.json(fixed);
    }

    // The router's rewrite of the question, when it passes the checks (non-empty, at
    // most 500 characters, no roster name, only this scope's refs): the selection call
    // gets it as written (refs, no names) and the opening call and the code-side
    // readers (compare words, compare rows) with its refs as names (the opening's own
    // checks still read only the message as typed). Otherwise, or when it is the
    // question unchanged, the question as asked.
    const standalone = acceptedStandaloneQuestion(routed.standaloneQuestion, index, scopedIds.length);
    const isRewritten = standalone !== null && standalone !== question;
    const selectionQuestion = isRewritten ? standalone : question;
    const openingQuestion = isRewritten
      ? replaceRefs(
          standalone,
          scopedCompanies.map((company) => company.name)
        )
      : newMessage;
    // A follow-up about the same companies: the lines the latest answer showed, for "nothing new".
    const followUp = routed.isFollowUp ? parseFollowUpContext(body.history, scope) : null;

    // "Compare …", "side by side", "vs" about 2–3 companies is a compare, whatever
    // label the router chose (never over an answer-key, off-topic or refused question).
    const decision: RouterDecision =
      scope.companyIds.length >= 2 && isCompareRequest(openingQuestion) && COMPARE_OVERRIDABLE_INTENTS.has(routed.intent)
        ? { ...routed, intent: "compare", topic: null, attribute: null, exactValue: false }
        : routed;

    if (researchResult?.error) {
      console.error("[data-room-chat] research facts", researchResult.error);
      return NextResponse.json(
        { error: "Could not load attached company information." },
        { status: 500 }
      );
    }

    const { data: contacts, error: contactsError } = contactsResult;
    if (contactsError) {
      console.error("[data-room-chat] contacts", contactsError);
      return NextResponse.json(
        { error: "Could not load attached company information." },
        { status: 500 }
      );
    }

    const contactsByCompany = new Map<string, Array<{ name: string; title: string; department: string }>>();
    for (const contact of contacts ?? []) {
      const companyId = String(contact.company_id);
      const list = contactsByCompany.get(companyId) ?? [];
      list.push({
        name: String(contact.contact_name ?? ""),
        title: String(contact.contact_title ?? ""),
        department: String(contact.department ?? ""),
      });
      contactsByCompany.set(companyId, list);
    }

    // The policy decides which facts are allowed (findings only for a specific
    // research question about one company, matching its topic).
    const findings = parseResearchFindings(researchResult?.data?.research_facts);
    const allowed = allowedFacts({
      intent: decision.intent,
      topic: decision.topic,
      scope,
      companies: scopedIds.map((id) => ({ id, findings: id === singleCompanyId ? findings : [] })),
    });
    if (allowed.reply) {
      const reply: ScopedAnswer = { intro: allowed.reply, items: [] };
      return NextResponse.json(reply);
    }

    // Facts are built at read time from the stored values (no data change).
    const companies: ScopedCompany[] = scopedIds.flatMap((id) => {
      const row = rosterById.get(id);
      if (!row) {
        return [];
      }
      const source: CompanyFactSource = {
        id,
        industry: row.industry,
        vertical: row.vertical,
        locations: typeof row.locations === "number" && Number.isFinite(row.locations) ? row.locations : null,
        metro: row.metro,
        inTerritory: typeof row.in_territory === "boolean" ? row.in_territory : null,
        sizeNote: row.size_note,
        onlineBooking: typeof row.online_booking === "boolean" ? row.online_booking : null,
        blurb: row.blurb,
        publicSignals: parseStringArray(row.public_signals),
        contacts: contactsByCompany.get(id) ?? [],
        findings: id === singleCompanyId ? findings : [],
      };
      return [{ id, name: String(row.company_name ?? ""), source, facts: buildCompanyFacts(source) }];
    });
    const block = (company: ScopedCompany, lines: CompanyBlock["lines"]): CompanyBlock => ({
      companyId: company.id,
      companyName: company.name,
      lines,
    });
    // The selection call sees the allowed findings and public facts (name-redacted).
    const selectable = (company: ScopedCompany): SelectableFact[] =>
      toSelectableFacts(
        [
          ...allowedFindings(company.facts, allowed.companies[company.id]),
          ...allowedPublicFacts(company.facts, allowed.companies[company.id]),
        ],
        refLabels.get(company.id) ?? "C1",
        (text) => redactFactText(text, index, company)
      );

    let answer: ScopedAnswer;
    const path = answerPathFor(decision);
    switch (path.kind) {
      case "attribute": {
        answer = renderAnswer(
          companies.map((company) => block(company, attributeLines(company.facts, path.attribute))),
          true
        );
        // Contacts never hold emails or phone numbers: an exact contact detail isn't findable.
        if (path.attribute === "contacts" && decision.exactValue) {
          answer = withExactDetailIntro(answer);
        }
        break;
      }
      case "select": {
        // Every finding the policy allowed (stored order, whatever the model picked),
        // then the public lines the selection call adds; nothing from either → the
        // nothing-findable reply.
        const selection = await selectFacts(openai, selectionQuestion, companies.flatMap(selectable), models.selection);
        answer = renderAnswer(
          companies.map((company) =>
            block(company, [
              ...allowedFindings(company.facts, allowed.companies[company.id]).map(factLine),
              ...selection.facts.filter((entry) => entry.companyId === company.id && entry.kind !== "h").map(factLine),
            ])
          ),
          singleCompanyId !== null
        );
        if (decision.exactValue && !selection.exactAnswer) {
          answer = withExactDetailIntro(answer);
        } else if (selection.saysNoFactAnswers && !isBroadTopic(decision.topic)) {
          // The selection call says no fact answers a narrow question: the allowed
          // findings still show, unchanged, under an honest first line (so no opening
          // sentence). Never on a broad topic (risks, fit, recent changes): there the
          // findings the policy allowed are the answer, so the opening path runs.
          answer = withRelatedFindingsIntro(answer);
        }
        break;
      }
      default: {
        // Overview, compare (each company's overview) and meta or bulk requests: no model call.
        answer = renderAnswer(
          companies.map((company) => block(company, overviewLines(company.facts))),
          true
        );
        // An answer-key or rule-breaking question still gets the public overview, under
        // a fixed first line (so no opening sentence).
        if (decision.intent === "meta_or_bulk" && hasFacts(answer)) {
          answer = { ...answer, intro: META_PUBLIC_INTRO };
        }
        // Compare about 2–3 companies: the same overviews, with card values and signals
        // for the side-by-side table (the text stays the fallback); only the rows the
        // question names ("only for locations"), or every row when it names none.
        if (decision.intent === "compare") {
          answer = withCompareLayout(
            answer,
            companies.map((company) => company.source),
            compareRowsFor(openingQuestion)
          );
        }
      }
    }

    // A follow-up that brings back only lines the last answer already showed says so
    // in a fixed first line (so no opening sentence).
    if (followUp) {
      answer = withNothingNewIntro(answer, followUp.shownLines);
    }

    // Exactly one first line on an answer with facts: its own, else the opening
    // (written last, from the finished answer, checked), else the fixed line.
    const finished = await withAnswerFirstLine(
      openai,
      { prompt: openingQuestion, asked: newMessage },
      decision,
      answer,
      index,
      models.opening,
      chatConfig
    );
    // A research question about 2–3 companies: findings are shared one company at a time.
    const noted: ScopedAnswer =
      scope.companyIds.length >= 2 && decision.intent === "specific_research"
        ? { ...finished, note: ONE_COMPANY_RESEARCH_NOTE }
        : finished;
    // A filter question about one company, or one starting "which ones / which of
    // them / which companies": the answer as it is, and the pane offers "Search all
    // companies" under it.
    return NextResponse.json(
      singleCompanyId !== null && (decision.intent === "filter_list" || isWhichOnesQuestion(newMessage))
        ? { ...noted, suggestAllCompanies: true }
        : noted
    );
  } catch (error) {
    console.error("[data-room-chat] unexpected:", error);
    return NextResponse.json(
      { error: "Could not generate a Data Room response." },
      { status: 500 }
    );
  }
}
