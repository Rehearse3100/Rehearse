/**
 * data-room-chat/route.ts
 * POST — Data Room AI Research Assistant, extractive: every answer is rendered by
 * code from stored facts; the model never writes a fact. The only model-written text
 * is a one-sentence opening, written last by its own call from the question and the
 * finished answer text only (companies as "Company 1", "Company 2"…), checked by
 * code and shown above the facts — never on a nothing-findable or fixed reply; if it
 * fails or is dropped, the answer goes out unchanged. The client sends a
 * scope (1–3 company ids, or all companies) and the question; facts are loaded
 * server-side. Flow: unselected-company mention or company-names question → server
 * reply; otherwise a router call (lib/data-room-chat-router.ts; sees only the
 * redacted question, recent questions and scope kind) labels the question. All
 * companies: no model picks or reads company data — one validated filter runs over
 * the roster in code (only the opening call sees the finished list), and anything
 * else gets a fixed reply (lib/data-room-chat-filter.ts).
 * One to three companies: the code-side policy (lib/data-room-chat-policy.ts)
 * decides which facts are allowed; overview, compare and attribute questions are
 * rendered with no further model call; specific research and filter questions show
 * every finding the policy allowed (stored order) plus the public facts one
 * selection call picks — it sees the allowed findings and the public facts, returns
 * fact ids (checked against the facts it was given; it can't add or remove a
 * finding) and whether one states the exact detail asked. When the router says the
 * question asks for one exact detail and no fact states it, the answer starts with
 * "That exact detail isn't publicly findable. Related facts:" (also above a contacts
 * line, which never holds emails or phone numbers). Everything is rendered from the
 * stored text (lib/data-room-chat-render.ts). Company names in answers come from the
 * database; the model sees companies only as refs ([C1]…).
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import { answerAllCompanies, type FilterCompany } from "@/lib/data-room-chat-filter";
import { allowedFacts } from "@/lib/data-room-chat-policy";
import {
  allowedFindings,
  allowedPublicFacts,
  answerPathFor,
  attributeLines,
  buildCompanyFacts,
  buildOpeningMessages,
  buildSelectionMessages,
  checkOpening,
  hasFacts,
  overviewLines,
  parseOpening,
  parseSelection,
  renderAnswer,
  toSelectableFacts,
  withExactDetailIntro,
  withOpening,
  type CompanyBlock,
  type CompanyFacts,
  type SelectableFact,
  type Selection,
} from "@/lib/data-room-chat-render";
import {
  buildRouterMessages,
  OVERVIEW_DECISION,
  parseRouterReply,
  scopeKindOf,
  type RouterDecision,
} from "@/lib/data-room-chat-router";
import {
  answerNameQuery,
  buildOutOfScopeMessage,
  buildRefLabels,
  buildScopeIndex,
  findOutOfScopeMentions,
  firstWordAsWritten,
  parseChatScope,
  parseHistoryQuestions,
  parseNameQuery,
  redactCompanyMentions,
  type FirstWordReplacement,
  type ScopeIndex,
  type ScopedAnswer,
} from "@/lib/data-room-chat-scope";
import { createServiceClient } from "@/lib/supabase/server";
import { parseResearchFindings } from "@/lib/data-room-research-topics";

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

/** One company in scope: its name from the database and its facts. */
type ScopedCompany = { id: string; name: string; facts: CompanyFacts };

/** Visible-layer roster columns (never answer-key or hidden-layer fields). */
const ROSTER_COLUMNS =
  "id, company_name, industry, vertical, locations, metro, in_territory, size_note, online_booking, blurb, public_signals";

const ROUTER_TEMPERATURE = 0;
/** Room for the decision and its All-companies filter. */
const ROUTER_MAX_TOKENS = 300;
const SELECTION_TEMPERATURE = 0;
/** Room for every fact id of up to three companies. */
const SELECTION_MAX_TOKENS = 500;
/** A little variety in the opening's wording; the facts never come from it. */
const OPENING_TEMPERATURE = 0.3;
/** Room for one sentence of at most 30 words, in JSON. */
const OPENING_MAX_TOKENS = 100;

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
 * The router call (gpt-4o, temperature 0, JSON). It sees only the redacted question,
 * recent questions and scope kind. Any failure counts as an overview (public facts only).
 */
async function classifyQuestion(
  openai: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<RouterDecision> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: ROUTER_TEMPERATURE,
      max_tokens: ROUTER_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages,
    });
    return parseRouterReply(response.choices[0]?.message?.content);
  } catch (error) {
    console.error("[data-room-chat] router:", error);
    return OVERVIEW_DECISION;
  }
}

/**
 * One selection call (gpt-4o, temperature 0, JSON): the redacted question and the
 * allowed facts in; fact ids and whether one states the exact detail out (only ids
 * among the given facts are kept).
 */
async function selectFacts(openai: OpenAI, question: string, facts: SelectableFact[]): Promise<Selection> {
  if (facts.length === 0) {
    return { facts: [], exactAnswer: false };
  }
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: SELECTION_TEMPERATURE,
    max_tokens: SELECTION_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: buildSelectionMessages(question, facts),
  });
  return parseSelection(response.choices[0]?.message?.content, facts);
}

/**
 * The opening call (gpt-4o, temperature 0.3, JSON), made once the answer is final
 * and only when it shows facts: it sees the question and the answer text the
 * student will see (companies as "Company 1"…). Its sentence goes above the answer
 * if it passes the checks; a failed call or a dropped sentence leaves the answer
 * unchanged.
 */
async function withWrittenOpening(
  openai: OpenAI,
  question: string,
  answer: ScopedAnswer,
  index: ScopeIndex
): Promise<ScopedAnswer> {
  if (!hasFacts(answer)) {
    return answer;
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: OPENING_TEMPERATURE,
      max_tokens: OPENING_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: buildOpeningMessages(question, answer, index),
    });
    const opening = parseOpening(response.choices[0]?.message?.content);
    return withOpening(answer, checkOpening(opening, question, answer, index));
  } catch (error) {
    console.error("[data-room-chat] opening:", error);
    return answer;
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

    const simulationId = String(attempt.simulation_id);

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

    // Questions about company NAMES are answered from the database (the question's
    // scope only); the model is not called, so names never come from it.
    const nameQuery = parseNameQuery(newMessage);
    if (nameQuery) {
      const reply = answerNameQuery(
        nameQuery,
        scopedIds.flatMap((id) => {
          const row = rosterById.get(id);
          return row ? [toListCompany(row)] : [];
        })
      );
      return NextResponse.json(reply);
    }

    const singleCompanyId =
      scope.mode === "companies" && scope.companyIds.length === 1 ? scope.companyIds[0] : null;
    const refLabels = buildRefLabels(scopedIds);
    const openingQuestion = newMessage.slice(0, 8_000);
    const question = redactStudentText(openingQuestion, index, refLabels);
    const openai = new OpenAI({ apiKey });

    // The router never sees facts or company data.
    const routerMessages = buildRouterMessages({
      question,
      recentQuestions: parseHistoryQuestions(body.history).map((text) =>
        redactStudentText(text, index, refLabels)
      ),
      scopeKind: scopeKindOf(scope),
    });

    // All companies: one validated filter runs over the roster in code (results from
    // the database), then the opening is written for the list; anything else gets
    // the fixed one-thing-at-a-time reply (no opening call).
    if (scope.mode === "all") {
      const decision = await classifyQuestion(openai, routerMessages);
      const answer = answerAllCompanies(decision, roster.map(toListCompany));
      return NextResponse.json(await withWrittenOpening(openai, openingQuestion, answer, index));
    }

    // One to three companies: the router runs alongside the data loads.
    const [decision, researchResult, contactsResult] = await Promise.all([
      classifyQuestion(openai, routerMessages),
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
      return [
        {
          id,
          name: String(row.company_name ?? ""),
          facts: buildCompanyFacts({
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
          }),
        },
      ];
    });
    const block = (company: ScopedCompany, lines: readonly string[]): CompanyBlock => ({
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
        const selection = await selectFacts(openai, question, companies.flatMap(selectable));
        answer = renderAnswer(
          companies.map((company) =>
            block(company, [
              ...allowedFindings(company.facts, allowed.companies[company.id]).map((entry) => entry.display),
              ...selection.facts
                .filter((entry) => entry.companyId === company.id && entry.kind !== "h")
                .map((entry) => entry.display),
            ])
          ),
          singleCompanyId !== null
        );
        if (decision.exactValue && !selection.exactAnswer) {
          answer = withExactDetailIntro(answer);
        }
        break;
      }
      default: {
        // Overview, compare (each company's overview) and meta or bulk requests: no model call.
        answer = renderAnswer(
          companies.map((company) => block(company, overviewLines(company.facts))),
          true
        );
      }
    }

    // Written last, from the finished answer; above the facts if it passes the checks (every path).
    return NextResponse.json(await withWrittenOpening(openai, openingQuestion, answer, index));
  } catch (error) {
    console.error("[data-room-chat] unexpected:", error);
    return NextResponse.json(
      { error: "Could not generate a Data Room response." },
      { status: 500 }
    );
  }
}
