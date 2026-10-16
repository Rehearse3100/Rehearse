/**
 * data-room-chat-route.test.ts
 * POST /api/student/data-room-chat against a fake database and a mocked OpenAI
 * client (no network). One to three companies, extractive answers: overview,
 * compare and attribute questions are rendered with no answering call; specific
 * research and filter questions show every finding the policy allowed, then the
 * public facts one selection call picks (it sees the allowed findings and public
 * facts and can't add or remove a finding); the exact-detail intro when the router
 * asks for one exact detail and no fact states it (also above contacts); selected
 * ids are checked against the facts given and rendered from the stored text with
 * names from the database. The opening sentence, written last by its own call from
 * the question and the finished answer text only (names as Company 1…): on every
 * answer path and above a filter list or the exact-detail line; no call on fixed
 * replies, name questions or the nothing-findable reply; dropped when it fails a
 * check or the call fails. All companies: 1–3 validated conditions run in code (no
 * selection call; different fields AND, same field OR, locations AND; valid filters
 * used even at low confidence), anything else the fixed reply. Also: the router call (sees no
 * facts, fails closed), the out-of-scope mention reply, company-name questions and
 * request checks.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/data-room-chat/route";
import { ALL_MODE_REPLY } from "@/lib/data-room-chat-filter";
import { OFF_TOPIC_REPLY } from "@/lib/data-room-chat-policy";
import {
  EXACT_DETAIL_MISSING_INTRO,
  NOTHING_FINDABLE_REPLY,
  OPENING_SYSTEM_PROMPT,
  SELECTION_SYSTEM_PROMPT,
} from "@/lib/data-room-chat-render";
import { ROUTER_SYSTEM_PROMPT } from "@/lib/data-room-chat-router";

// ── Fakes ───

type Query = {
  table: string;
  columns: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
};

const state = vi.hoisted(() => ({
  /** Selection calls. */
  create: vi.fn(),
  /** Router calls. */
  classify: vi.fn(),
  /** Opening-sentence calls. */
  open: vi.fn(),
  queries: [] as Query[],
  /** research_facts as stored, when a test needs a shape other than the tagged fixture. */
  storedResearchFacts: null as unknown,
  /** A larger roster, when a test needs one. */
  roster: null as unknown[] | null,
}));

vi.mock("openai", async () => {
  const { ROUTER_SYSTEM_PROMPT: routerPrompt } = await import("@/lib/data-room-chat-router");
  const { OPENING_SYSTEM_PROMPT: openingPrompt } = await import("@/lib/data-room-chat-render");
  return {
    default: class {
      chat = {
        completions: {
          // By system prompt: the router call goes to state.classify, the opening call
          // to state.open, selection calls to state.create.
          create: (args: { messages: Array<{ content: string }> }): unknown => {
            const system = args.messages[0]?.content;
            if (system === routerPrompt) {
              return state.classify(args);
            }
            return system === openingPrompt ? state.open(args) : state.create(args);
          },
        },
      };
    },
  };
});

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

const ROSTER = [
  {
    id: "summit-dental",
    company_name: "Summit Dental Group",
    industry: "Dental",
    vertical: "dental",
    locations: 8,
    metro: "Front Range, CO",
    in_territory: true,
    size_note: "8 locations across the Front Range",
    online_booking: false,
    blurb: "Summit Dental Group runs eight clinics. Summit is growing fast.",
    public_signals: ["Opened 8th location three months ago"],
  },
  {
    id: "summit-outdoor",
    company_name: "Summit Outdoor Gear",
    industry: "Retail",
    vertical: "retail",
    locations: 2,
    metro: "Boise, ID",
    in_territory: false,
    size_note: null,
    online_booking: true,
    blurb: "Outdoor retailer.",
    public_signals: [],
  },
  {
    id: "falcon",
    company_name: "Falcon Market",
    industry: "Retail",
    vertical: "retail",
    locations: 1,
    metro: "Denver, CO",
    in_territory: true,
    size_note: null,
    online_booking: false,
    blurb: "Falcon Market sells local produce.",
    public_signals: ["Hiring a cashier"],
  },
  {
    id: "maple",
    company_name: "Maple Family Dentistry",
    industry: "Dental",
    vertical: "dental",
    locations: 3,
    metro: "Boulder, CO",
    in_territory: true,
    size_note: null,
    online_booking: true,
    blurb: null,
    public_signals: [],
  },
  {
    id: "cedar",
    company_name: "Cedar Grove Family Dentistry",
    industry: "Dental",
    vertical: "dental",
    locations: 4,
    metro: "Denver, CO",
    in_territory: null,
    size_note: null,
    online_booking: null,
    blurb: null,
    public_signals: [],
  },
  {
    id: "harbor",
    company_name: "Harbor Family Dentistry",
    industry: "Dental",
    vertical: "dental",
    locations: 2,
    metro: "Fort Collins, CO",
    in_territory: true,
    size_note: null,
    online_booking: null,
    blurb: null,
    public_signals: [],
  },
];

const TOOLS_FINDING = "Signed a multi-year agreement with a scheduling vendor last year.";
const BUDGET_FINDING = "Finance memo cites a freeze on discretionary software spend.";
const AMENITIES_FINDING = "Patients praised the renovated waiting room in a local magazine.";
const RESEARCH_FACTS = [TOOLS_FINDING, BUDGET_FINDING, AMENITIES_FINDING];
const STORED_FINDINGS = [
  { text: TOOLS_FINDING, topics: ["current_tools"] },
  { text: BUDGET_FINDING, topics: ["budget"] },
  { text: AMENITIES_FINDING, topics: ["amenities"] },
];

const CONTACTS = [
  { company_id: "summit-dental", contact_name: "Dana Reyes", contact_title: "Director of Operations", department: "Operations" },
  { company_id: "falcon", contact_name: "Pat Lee", contact_title: "Owner", department: "" },
];

/** Answers each query the way the database would for this fixture. */
function respond(query: Query): { data: unknown; error: unknown } {
  if (query.table === "attempts") {
    return { data: { id: "attempt-1", simulation_id: "sim-1" }, error: null };
  }
  if (query.table === "crm_prospect_directory" && query.columns === "research_facts") {
    return { data: { research_facts: state.storedResearchFacts ?? STORED_FINDINGS }, error: null };
  }
  if (query.table === "crm_prospect_directory") {
    return { data: state.roster ?? ROSTER, error: null };
  }
  if (query.table === "crm_prospect_contacts") {
    const ids = query.ins[0]?.[1] ?? [];
    return { data: CONTACTS.filter((c) => ids.includes(c.company_id)), error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const query: Query = { table, columns: "", eqs: [], ins: [] };
      state.queries.push(query);
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.eqs.push([column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          query.ins.push([column, values]);
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(respond(query));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(respond(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

// ── Helpers ───

type ModelMessage = { role: string; content: string };

function modelReply(body: unknown): { choices: Array<{ message: { content: string } }> } {
  return { choices: [{ message: { content: typeof body === "string" ? body : JSON.stringify(body) } }] };
}

/** A confident router decision. */
function routerReply(
  intent: string,
  topic: string | null = null,
  attribute: string | null = null,
  exactValue = false
): { choices: Array<{ message: { content: string } }> } {
  return modelReply({ intent, topic, attribute, exact_value: exactValue, confidence: "high" });
}

function selection(ids: unknown[], exactAnswer = false): { choices: Array<{ message: { content: string } }> } {
  return modelReply({ fact_ids: ids, exact_answer: exactAnswer });
}

function chatRequest(body: Record<string, unknown>): Request {
  return new Request("http://x/api/student/data-room-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: "attempt-1", newMessage: "What are their risks?", ...body }),
  });
}

async function ask(body: Record<string, unknown>): Promise<unknown> {
  return (await POST(chatRequest(body))).json();
}

/** Messages passed to the selection call with this index. */
function selectionMessages(call = 0): ModelMessage[] {
  return (state.create.mock.calls[call]?.[0] as { messages: ModelMessage[] }).messages;
}

/** The fact lines ("id: fact") of a selection call. */
function factLines(call = 0): string[] {
  return (selectionMessages(call)[1]?.content ?? "").split("\n").slice(2);
}

const ONE = { mode: "companies", companyIds: ["summit-dental"] };
const TWO = { mode: "companies", companyIds: ["summit-dental", "falcon"] };
const ALL = { mode: "all" };
const ALL_NAMES = ROSTER.map((row) => row.company_name);

const SUMMIT_OVERVIEW = [
  "Dental · 8 locations · Front Range, CO",
  "In territory.",
  "No online booking.",
  "Summit Dental Group runs eight clinics. Summit is growing fast.",
  "Opened 8th location three months ago",
].join("\n");

beforeEach(() => {
  state.create.mockReset();
  state.classify.mockReset();
  state.classify.mockResolvedValue(routerReply("overview"));
  // No opening unless a test asks for one.
  state.open.mockReset();
  state.open.mockResolvedValue(modelReply({ opening: "" }));
  state.queries = [];
  state.storedResearchFacts = null;
  state.roster = null;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

// ── Tests ───

describe("answers rendered with no answering call", () => {
  it("overview: the company's public facts in a fixed order, name from the database", async () => {
    expect(await ask({ scope: ONE, newMessage: "Tell me about them" })).toEqual({
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: SUMMIT_OVERVIEW }],
    });
    expect(state.classify).toHaveBeenCalledTimes(1);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("attribute lookup: that attribute's sentence for each company; no value → nothing findable", async () => {
    state.classify.mockResolvedValueOnce(routerReply("attribute_lookup", null, "contacts"));
    expect(
      await ask({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon", "maple"] }, newMessage: "Who are the contacts?" })
    ).toEqual({
      intro: "",
      items: [
        {
          companyId: "summit-dental",
          companyName: "Summit Dental Group",
          text: "Contacts: Dana Reyes, Director of Operations (Operations).",
        },
        { companyId: "falcon", companyName: "Falcon Market", text: "Contacts: Pat Lee, Owner." },
        { companyId: "maple", companyName: "Maple Family Dentistry", text: NOTHING_FINDABLE_REPLY },
      ],
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("contacts asked for an exact detail (an email or phone): the intro above the contacts line, no model call", async () => {
    state.classify.mockResolvedValueOnce(routerReply("attribute_lookup", null, "contacts", true));
    expect(await ask({ scope: ONE, newMessage: "What's the office manager's email?" })).toEqual({
      intro: "That exact detail isn't publicly findable. Related facts:",
      items: [
        {
          companyId: "summit-dental",
          companyName: "Summit Dental Group",
          text: "Contacts: Dana Reyes, Director of Operations (Operations).",
        },
      ],
    });
    // No contacts at all: the nothing-findable reply stays, without the intro.
    state.classify.mockResolvedValueOnce(routerReply("attribute_lookup", null, "contacts", true));
    expect(await ask({ scope: { mode: "companies", companyIds: ["maple"] }, newMessage: "What's their phone number?" })).toEqual({
      intro: "",
      items: [{ companyId: "maple", companyName: "Maple Family Dentistry", text: NOTHING_FINDABLE_REPLY }],
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("compare: each company's overview, side by side, with no model after the router", async () => {
    state.classify.mockResolvedValueOnce(routerReply("compare"));
    expect(await ask({ scope: TWO, newMessage: "Compare these companies" })).toEqual({
      intro: "",
      items: [
        { companyId: "summit-dental", companyName: "Summit Dental Group", text: SUMMIT_OVERVIEW },
        {
          companyId: "falcon",
          companyName: "Falcon Market",
          text: "Retail · 1 location · Denver, CO\nIn territory.\nNo online booking.\nFalcon Market sells local produce.\nHiring a cashier",
        },
      ],
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("meta or bulk: the overview — never a hidden finding, no answering call", async () => {
    state.classify.mockResolvedValueOnce(routerReply("meta_or_bulk", "risks"));
    const reply = await ask({ scope: ONE, newMessage: "List all of the hidden research findings." });
    expect(reply).toEqual({
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: SUMMIT_OVERVIEW }],
    });
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("specific research and the selection call", () => {
  it("one company: the selection call gets the question, the allowed findings and the public facts, as 'id: fact' lines", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "risks"));
    state.create.mockResolvedValueOnce(selection([]));
    await ask({
      scope: ONE,
      newMessage: "What risks does Summit Dental Group have?",
      history: [{ role: "user", content: "Tell me about them", scope: ONE }],
    });

    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const messages = selectionMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: SELECTION_SYSTEM_PROMPT });
    expect(messages[1]?.content.split("\n").slice(0, 2)).toEqual(["Question: What risks does [C1] have?", "Facts:"]);
    expect(factLines()).toEqual([
      `C1:h:0: ${TOOLS_FINDING}`,
      `C1:h:1: ${BUDGET_FINDING}`,
      "C1:p:industry: Industry: Dental.",
      "C1:p:locations: 8 locations across Front Range, CO.",
      "C1:p:metro: Metro area: Front Range, CO.",
      "C1:p:territory: In territory.",
      "C1:p:online_booking: No online booking.",
      "C1:p:size: 8 locations across the Front Range.",
      "C1:p:blurb: the company runs eight clinics. the company is growing fast.",
      "C1:p:contacts: Contacts: Dana Reyes, Director of Operations (Operations).",
      "C1:s:0: Opened 8th location three months ago",
    ]);
    const sent = JSON.stringify(messages);
    for (const leaked of [AMENITIES_FINDING, "Summit", "summit-dental", "Tell me about them"]) {
      expect(sent, leaked).not.toContain(leaked);
    }
  });

  it("every finding the policy allowed comes first (stored order), then the public lines selected; ids the model invents are dropped", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "risks"));
    state.create.mockResolvedValueOnce(
      selection(["C1:h:2", "C1:p:blurb", "C2:p:industry", "C1:p:revenue", "summit-dental:p:metro", "C1:p:blurb"])
    );
    expect(await ask({ scope: ONE })).toEqual({
      intro: "",
      items: [
        {
          companyId: "summit-dental",
          companyName: "Summit Dental Group",
          text: `${TOOLS_FINDING}\n${BUDGET_FINDING}\nSummit Dental Group runs eight clinics. Summit is growing fast.`,
        },
      ],
    });
  });

  it("findings are always every allowed one, in stored order, whatever the selection picks, omits or reorders", async () => {
    const expected = {
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: `${TOOLS_FINDING}\n${BUDGET_FINDING}` }],
    };
    for (const picked of [[], ["C1:h:1"], ["C1:h:1", "C1:h:0", "C1:h:1"], ["C1:h:2"]]) {
      state.classify.mockResolvedValueOnce(routerReply("specific_research", "risks"));
      state.create.mockResolvedValueOnce(selection(picked, true));
      expect(await ask({ scope: ONE }), JSON.stringify(picked)).toEqual(expected);
    }
  });

  it("an exact detail no fact states: the intro, then the related facts; not when a fact states it or no exact detail was asked", async () => {
    const revenue = { scope: ONE, newMessage: "What's their annual revenue?" };
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "budget", null, true));
    state.create.mockResolvedValueOnce(selection([], false));
    expect(await ask(revenue)).toEqual({
      intro: "That exact detail isn't publicly findable. Related facts:",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: BUDGET_FINDING }],
    });

    const plain = {
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: BUDGET_FINDING }],
    };
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "budget", null, true));
    state.create.mockResolvedValueOnce(selection(["C1:h:1"], true));
    expect(await ask(revenue)).toEqual(plain);
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "budget", null, false));
    state.create.mockResolvedValueOnce(selection([], false));
    expect(await ask(revenue)).toEqual(plain);
  });

  it("an exact detail with no facts at all keeps the nothing-findable reply (no intro)", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "ownership", null, true));
    state.create.mockResolvedValueOnce(selection([], false));
    expect(await ask({ scope: ONE, newMessage: "How many owners does it have?" })).toEqual({
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: NOTHING_FINDABLE_REPLY }],
    });
  });

  it("allowed findings are shown even when the selection call picks nothing; a single fact topic shares every match", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "amenities"));
    state.create.mockResolvedValueOnce(selection([], true));
    expect(await ask({ scope: ONE, newMessage: "What are the amenities like?" })).toEqual({
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: AMENITIES_FINDING }],
    });
  });

  it("nothing from either (no allowed finding, no public line) → exactly the nothing-findable reply", async () => {
    state.classify.mockResolvedValue(routerReply("specific_research", "ownership"));
    state.create
      .mockResolvedValueOnce(selection([], true))
      .mockResolvedValueOnce(selection(["C1:h:0"]))
      .mockResolvedValueOnce(modelReply("not json"))
      .mockResolvedValueOnce(selection([]));
    const nothing = {
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: NOTHING_FINDABLE_REPLY }],
    };
    for (let i = 0; i < 3; i += 1) {
      expect(await ask({ scope: ONE, newMessage: "What's the owner's email address?" })).toEqual(nothing);
    }
    expect(await ask({ scope: TWO })).toEqual({ intro: NOTHING_FINDABLE_REPLY, items: [] });
  });

  it("older untagged findings (string[]) are never shown or offered", async () => {
    state.storedResearchFacts = RESEARCH_FACTS;
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "risks"));
    state.create.mockResolvedValueOnce(selection([]));
    const reply = await ask({ scope: ONE });
    expect(factLines().some((line) => line.startsWith("C1:h:"))).toBe(false);
    for (const fact of RESEARCH_FACTS) {
      expect(JSON.stringify(reply)).not.toContain(fact);
    }
  });

  it("two companies: one call over both companies' public facts; companies with no selected fact are left out", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "risks"));
    state.create.mockResolvedValueOnce(selection(["C2:s:0", "C2:p:online_booking"]));
    expect(await ask({ scope: TWO })).toEqual({
      intro: "",
      items: [{ companyId: "falcon", companyName: "Falcon Market", text: "Hiring a cashier\nNo online booking." }],
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(factLines().some((line) => line.startsWith("C1:"))).toBe(true);
    expect(factLines().some((line) => line.startsWith("C2:"))).toBe(true);
    expect(factLines().some((line) => /^C\d:h:/.test(line))).toBe(false);
    expect(state.queries.some((q) => q.columns === "research_facts")).toBe(false);
  });

  it("no company name reaches a selection call; names in the question become refs", async () => {
    state.classify.mockResolvedValue(routerReply("specific_research", "risks"));
    state.create.mockResolvedValue(selection([]));
    await ask({ scope: TWO, newMessage: "What are Summit Dental Group's risks compared with Falcon Market?" });
    await ask({ scope: ONE });

    expect(selectionMessages(0)[1]?.content.split("\n")[0]).toBe("Question: What are [C1]'s risks compared with [C2]?");
    for (const call of [0, 1]) {
      const sent = JSON.stringify(selectionMessages(call)).toLowerCase();
      for (const name of ALL_NAMES) {
        expect(sent, name).not.toContain(name.toLowerCase());
      }
    }
  });
});

describe("the opening sentence, written last from the finished answer", () => {
  const OPENING = "Here's what's on record for your question.";
  const opening = (text: string): ReturnType<typeof modelReply> => modelReply({ opening: text });
  /** Arguments of the opening call with this index. */
  const openingArgs = (call = 0): { messages: ModelMessage[] } & Record<string, unknown> =>
    state.open.mock.calls[call]?.[0] as { messages: ModelMessage[] } & Record<string, unknown>;

  it("one gpt-4o call after the answer is built, seeing only the question and the answer text (names as Company 1…)", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "budget"));
    state.create.mockResolvedValueOnce(selection(["C1:p:locations"]));
    state.open.mockResolvedValueOnce(opening(OPENING));
    expect(await ask({ scope: ONE, newMessage: "What about Summit Dental Group's budget?" })).toEqual({
      intro: OPENING,
      items: [
        {
          companyId: "summit-dental",
          companyName: "Summit Dental Group",
          text: `${BUDGET_FINDING}\n8 locations across Front Range, CO.`,
        },
      ],
    });
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.open.mock.invocationCallOrder[0]!).toBeGreaterThan(state.create.mock.invocationCallOrder[0]!);
    expect(openingArgs()).toMatchObject({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });
    expect(openingArgs().messages).toEqual([
      { role: "system", content: OPENING_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Question: What about Company 1's budget?\n\nAnswer:\nCompany 1\n${BUDGET_FINDING}\n8 locations across Front Range, CO.`,
      },
    ]);
    // Nothing the answer doesn't show: no other finding, no contact, no name or id.
    const sent = JSON.stringify(openingArgs().messages);
    for (const hidden of [TOOLS_FINDING, AMENITIES_FINDING, "Dana Reyes", "Summit", "summit-dental"]) {
      expect(sent, hidden).not.toContain(hidden);
    }
  });

  it("shows above the facts on every 1–3 company path: overview, compare, attribute, specific research", async () => {
    state.open.mockResolvedValue(opening(OPENING));
    expect(await ask({ scope: ONE, newMessage: "Tell me about them" })).toEqual({
      intro: OPENING,
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: SUMMIT_OVERVIEW }],
    });

    state.classify.mockResolvedValueOnce(routerReply("compare"));
    const compared = (await ask({ scope: TWO, newMessage: "Compare these companies" })) as { intro: string; items: unknown[] };
    expect(compared.intro).toBe(OPENING);
    expect(compared.items).toHaveLength(2);
    expect(openingArgs(1).messages[1]?.content).toContain("Answer:\nCompany 1\nDental · 8 locations");
    expect(openingArgs(1).messages[1]?.content).toContain("\n\nCompany 2\nRetail · 1 location · Denver, CO");

    state.classify.mockResolvedValueOnce(routerReply("attribute_lookup", null, "locations"));
    expect(await ask({ scope: ONE, newMessage: "How many locations?" })).toEqual({
      intro: OPENING,
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: "8 locations across Front Range, CO." }],
    });

    state.classify.mockResolvedValueOnce(routerReply("specific_research", "budget"));
    state.create.mockResolvedValueOnce(selection([], true));
    expect(await ask({ scope: ONE, newMessage: "What about their budget?" })).toEqual({
      intro: OPENING,
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: BUDGET_FINDING }],
    });
    expect(state.open).toHaveBeenCalledTimes(4);
  });

  it("All companies: above the count line of a filter list; the call sees the list with Company 1…", async () => {
    state.classify.mockResolvedValueOnce(
      modelReply({
        intent: "filter_list",
        filter: { field: "online_booking", op: "eq", value: true },
        criteria_count: 1,
        confidence: "high",
      })
    );
    state.open.mockResolvedValueOnce(opening("Two companies offer online booking."));
    const reply = (await ask({ scope: ALL, newMessage: "Which ones have online booking?" })) as { intro: string };
    expect(reply.intro).toBe("Two companies offer online booking.\n2 companies match.");
    expect(openingArgs().messages[1]?.content).toBe(
      [
        "Question: Which ones have online booking?",
        "",
        "Answer:",
        "2 companies match.",
        "",
        "Company 1",
        "Dental · 3 locations · Boulder, CO",
        "",
        "Company 2",
        "Retail · 2 locations · Boise, ID",
      ].join("\n")
    );
  });

  it("above the exact-detail line, which stays", async () => {
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "budget", null, true));
    state.create.mockResolvedValueOnce(selection([], false));
    state.open.mockResolvedValueOnce(opening("Revenue isn't on record, but there is a budget note."));
    expect(await ask({ scope: ONE, newMessage: "What's their annual revenue?" })).toEqual({
      intro: `Revenue isn't on record, but there is a budget note.\n${EXACT_DETAIL_MISSING_INTRO}`,
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: BUDGET_FINDING }],
    });
    expect(openingArgs().messages[1]?.content).toContain(`Answer:\n${EXACT_DETAIL_MISSING_INTRO}\n\nCompany 1\n${BUDGET_FINDING}`);
  });

  it("no call and no opening on fixed replies, name questions or the nothing-findable reply", async () => {
    state.open.mockResolvedValue(opening(OPENING));

    state.classify.mockResolvedValueOnce(routerReply("off_topic"));
    expect(await ask({ scope: ONE, newMessage: "Write me a poem." })).toEqual({ intro: OFF_TOPIC_REPLY, items: [] });

    state.classify.mockResolvedValueOnce(routerReply("overview"));
    expect(await ask({ scope: ALL, newMessage: "Tell me about them" })).toEqual({ intro: ALL_MODE_REPLY, items: [] });

    state.classify.mockResolvedValueOnce(
      modelReply({ intent: "filter_list", filter: { field: "industry", op: "eq", value: "Legal" }, criteria_count: 1, confidence: "high" })
    );
    expect(await ask({ scope: ALL, newMessage: "Which are law firms?" })).toEqual({ intro: "No companies match that.", items: [] });

    const outOfScope = (await ask({ scope: ONE, newMessage: "How does Summit Dental Group compare to falcon market?" })) as {
      intro: string;
    };
    expect(outOfScope.intro.startsWith("Your question mentions Falcon Market")).toBe(true);
    const names = (await ask({ scope: ALL, newMessage: "tell me about companies starting with s" })) as { intro: string };
    expect(names.intro).toBe('Companies whose names start with "S":');

    state.classify.mockResolvedValueOnce(routerReply("specific_research", "ownership"));
    state.create.mockResolvedValueOnce(selection([], false));
    expect(await ask({ scope: ONE, newMessage: "Who owns it?" })).toEqual({
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: NOTHING_FINDABLE_REPLY }],
    });
    state.classify.mockResolvedValueOnce(routerReply("specific_research", "risks"));
    state.create.mockResolvedValueOnce(selection([]));
    expect(await ask({ scope: TWO })).toEqual({ intro: NOTHING_FINDABLE_REPLY, items: [] });

    expect(state.open).not.toHaveBeenCalled();
  });

  it("a sentence that fails a check, a failed call or a bad reply leaves the answer unchanged (no opening, never a fallback)", async () => {
    const unchanged = {
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: SUMMIT_OVERVIEW }],
    };
    for (const bad of [
      "Here's what's on record about Summit Dental Group.",
      "Here's what's on record about Company 1.",
      "Here's what's on record about [C1].",
      "Falcon has 2 stores.",
      "They have 12 locations.",
      "This one is the best prospect.",
      "It looks like a strong fit.",
      "Sure! Here's what's on record.",
    ]) {
      state.open.mockResolvedValueOnce(opening(bad));
      expect(await ask({ scope: ONE, newMessage: "Tell me about them" }), bad).toEqual(unchanged);
    }
    state.open.mockResolvedValueOnce(modelReply("not json"));
    expect(await ask({ scope: ONE, newMessage: "Tell me about them" })).toEqual(unchanged);
    state.open.mockRejectedValueOnce(new Error("opening down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await POST(chatRequest({ scope: ONE, newMessage: "Tell me about them" }));
    errorSpy.mockRestore();
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual(unchanged);
  });
});

describe("All companies: one validated filter, run in code", () => {
  function filterReply(filter: unknown, criteriaCount = 1): ReturnType<typeof modelReply> {
    return modelReply({ intent: "filter_list", topic: null, attribute: null, filter, criteria_count: criteriaCount, confidence: "high" });
  }

  it("runs the filter over the roster: a count, then names from the database A–Z; only the classifier is called", async () => {
    state.classify.mockResolvedValueOnce(filterReply({ field: "online_booking", op: "eq", value: true }));
    expect(await ask({ scope: ALL, newMessage: "Which ones have online booking?" })).toEqual({
      intro: "2 companies match.",
      items: [
        { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
        { companyId: "summit-outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" },
      ],
    });
    expect(state.classify).toHaveBeenCalledTimes(1);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.queries.some((q) => q.table === "crm_prospect_contacts" || q.columns === "research_facts")).toBe(false);
    const routerInput = (state.classify.mock.calls[0]?.[0] as { messages: ModelMessage[] }).messages[1]?.content ?? "";
    expect(routerInput.split("\n")[0]).toBe("Scope: all companies");
  });

  it("results match the roster for each field (a state name works too)", async () => {
    const run = async (filter: unknown): Promise<string[]> => {
      state.classify.mockResolvedValueOnce(filterReply(filter));
      const reply = (await ask({ scope: ALL, newMessage: "Which ones?" })) as { items: Array<{ companyName: string }> };
      return reply.items.map((item) => item.companyName);
    };
    expect(await run({ field: "state", op: "eq", value: "Colorado" })).toEqual([
      "Cedar Grove Family Dentistry",
      "Falcon Market",
      "Harbor Family Dentistry",
      "Maple Family Dentistry",
      "Summit Dental Group",
    ]);
    expect(await run({ field: "industry", op: "eq", value: "retail" })).toEqual(["Falcon Market", "Summit Outdoor Gear"]);
    expect(await run({ field: "metro", op: "contains", value: "Denver" })).toEqual(["Cedar Grove Family Dentistry", "Falcon Market"]);
    expect(await run({ field: "locations", op: "gte", value: 4 })).toEqual(["Cedar Grove Family Dentistry", "Summit Dental Group"]);
    expect(await run({ field: "territory", op: "eq", value: false })).toEqual(["Summit Outdoor Gear"]);
  });

  it("a 'how many' question read as a filter: the count intro answers it (singular for one)", async () => {
    state.classify.mockResolvedValueOnce(filterReply({ field: "industry", op: "contains", value: "dental" }));
    const dental = (await ask({ scope: ALL, newMessage: "how many are located dental?" })) as { intro: string; items: unknown[] };
    expect(dental.intro).toBe("4 companies match.");
    expect(dental.items).toHaveLength(4);

    state.classify.mockResolvedValueOnce(filterReply({ field: "territory", op: "eq", value: false }));
    expect(await ask({ scope: ALL, newMessage: "How many are outside my territory?" })).toEqual({
      intro: "1 company matches.",
      items: [{ companyId: "summit-outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" }],
    });
  });

  it("alphabetical, capped at 20, the rest counted; no matches", async () => {
    state.roster = Array.from({ length: 23 }, (_, i) => ({
      ...ROSTER[3],
      id: `clinic-${i}`,
      company_name: `Clinic ${String(22 - i).padStart(2, "0")} Health`,
    }));
    state.classify.mockResolvedValueOnce(filterReply({ field: "online_booking", op: "eq", value: true }));
    const reply = (await ask({ scope: ALL, newMessage: "Which ones have online booking?" })) as {
      intro: string;
      items: Array<{ companyName: string }>;
    };
    expect(reply.items.map((item) => item.companyName)).toEqual(
      Array.from({ length: 20 }, (_, i) => `Clinic ${String(i).padStart(2, "0")} Health`)
    );
    expect(reply.intro).toBe("23 companies match. Showing the first 20; use the search box above the list to see the rest.");

    state.classify.mockResolvedValueOnce(filterReply({ field: "industry", op: "eq", value: "Legal" }));
    expect(await ask({ scope: ALL, newMessage: "Which are law firms?" })).toEqual({ intro: "No companies match that.", items: [] });
  });

  it("more than one criterion, a filter outside the whitelist, or any other kind of question → the fixed reply, no answering call", async () => {
    const fixed = { intro: ALL_MODE_REPLY, items: [] };
    state.classify
      .mockResolvedValueOnce(filterReply({ field: "industry", op: "eq", value: "Dental" }, 2))
      .mockResolvedValueOnce(filterReply({ field: "software", op: "eq", value: "Zentrix" }))
      .mockResolvedValueOnce(filterReply(null, 0))
      .mockResolvedValueOnce(routerReply("overview"))
      .mockResolvedValueOnce(routerReply("specific_research", "risks"))
      .mockResolvedValueOnce(routerReply("compare"))
      .mockResolvedValueOnce(routerReply("meta_or_bulk"))
      .mockResolvedValueOnce(routerReply("off_topic"))
      .mockResolvedValueOnce(routerReply("attribute_lookup", null, "locations"))
      .mockRejectedValueOnce(new Error("router down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 10; i += 1) {
      expect(await ask({ scope: ALL, newMessage: "Which dental clinics in Denver have online booking?" }), String(i)).toEqual(
        fixed
      );
    }
    errorSpy.mockRestore();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("All companies: up to 3 conditions, run in code", () => {
  const DENTAL = { field: "industry", op: "contains", value: "dental" };
  const CO = { field: "state", op: "eq", value: "CO" };
  const BOOKING = { field: "online_booking", op: "eq", value: true };
  function filtersReply(filters: unknown, confidence = "high", intent = "filter_list"): ReturnType<typeof modelReply> {
    const criteriaCount = Array.isArray(filters) ? filters.length : 1;
    return modelReply({ intent, topic: null, attribute: null, filters, criteria_count: criteriaCount, confidence });
  }
  const run = async (reply: ReturnType<typeof modelReply>, newMessage = "Which ones?"): Promise<unknown> => {
    state.classify.mockResolvedValueOnce(reply);
    return ask({ scope: ALL, newMessage });
  };
  const names = (reply: unknown): string[] =>
    (reply as { items: Array<{ companyName: string }> }).items.map((item) => item.companyName);
  const fixed = { intro: ALL_MODE_REPLY, items: [] };

  it("two and three conditions on different fields must all match; no selection call", async () => {
    expect(names(await run(filtersReply([DENTAL, CO]), "Which dental companies are in Colorado?"))).toEqual([
      "Cedar Grove Family Dentistry",
      "Harbor Family Dentistry",
      "Maple Family Dentistry",
      "Summit Dental Group",
    ]);
    expect(await run(filtersReply([DENTAL, CO, BOOKING]), "Which dental companies in Colorado have online booking?")).toEqual({
      intro: "1 company matches.",
      items: [{ companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" }],
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("two conditions on the same field mean either one; two locations conditions both hold", async () => {
    expect(names(await run(filtersReply([CO, { field: "state", op: "eq", value: "Idaho" }]), "Which are in Colorado or Idaho?"))).toEqual([
      "Cedar Grove Family Dentistry",
      "Falcon Market",
      "Harbor Family Dentistry",
      "Maple Family Dentistry",
      "Summit Dental Group",
      "Summit Outdoor Gear",
    ]);
    const range = [
      { field: "locations", op: "gte", value: 2 },
      { field: "locations", op: "lte", value: 3 },
    ];
    expect(names(await run(filtersReply(range), "Which have between 2 and 3 locations?"))).toEqual([
      "Harbor Family Dentistry",
      "Maple Family Dentistry",
      "Summit Outdoor Gear",
    ]);
  });

  it('"Which companies are in CO?" lists the Colorado companies', async () => {
    expect(names(await run(filtersReply([CO]), "Which companies are in CO?"))).toEqual([
      "Cedar Grove Family Dentistry",
      "Falcon Market",
      "Harbor Family Dentistry",
      "Maple Family Dentistry",
      "Summit Dental Group",
    ]);
  });

  it("low confidence: valid filters still run in All companies mode, but not about 1–3 companies", async () => {
    expect(names(await run(filtersReply([DENTAL, CO], "low")))).toHaveLength(4);
    state.classify.mockResolvedValueOnce(filtersReply([CO], "low"));
    expect(await ask({ scope: ONE, newMessage: "Is it in Colorado?" })).toEqual({
      intro: "",
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: SUMMIT_OVERVIEW }],
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("more than 3 conditions, an invalid one, an unknown locations comparison or a hidden-research question → the new fixed reply", async () => {
    expect(ALL_MODE_REPLY).toBe(
      "In All companies mode I can filter by industry, city or state, number of locations, territory and online booking, up to 3 at a time. Open a company to research it in depth."
    );
    const territory = { field: "territory", op: "eq", value: true };
    for (const reply of [
      filtersReply([DENTAL, CO, BOOKING, territory]),
      filtersReply([DENTAL, { field: "software", op: "eq", value: "Zentrix" }]),
      filtersReply([{ field: "locations", op: "about", value: 3 }]),
      filtersReply([{ field: "budget", op: "contains", value: "freeze" }]),
      filtersReply(null),
      routerReply("specific_research", "risks"),
      routerReply("specific_research", "customer_feedback"),
      routerReply("specific_research", "current_tools"),
      routerReply("specific_research", "fit"),
      routerReply("compare"),
    ]) {
      expect(await run(reply, "Which companies have a budget freeze?"), JSON.stringify(reply)).toEqual(fixed);
    }
    expect(state.create).not.toHaveBeenCalled();
    expect(state.open).not.toHaveBeenCalled();
  });
});

describe("the router call", () => {
  it("sees only the redacted question, the last 3 redacted questions and the scope kind — no facts", async () => {
    await POST(
      chatRequest({
        scope: ONE,
        newMessage: "What software does Summit Dental Group use?",
        history: [
          { role: "user", content: "first", scope: ONE },
          { role: "user", content: "Tell me about Falcon Market", scope: { mode: "companies", companyIds: ["falcon"] } },
          { role: "assistant", intro: "", items: [{ companyId: "falcon", text: "It sells local produce." }], scope: ONE },
          { role: "user", content: "Who works at Summit Dental Group?", scope: ONE },
          { role: "user", content: "Any reviews?", scope: ONE },
        ],
      })
    );

    const args = state.classify.mock.calls[0]?.[0] as {
      messages: ModelMessage[];
      model: string;
      temperature: number;
      response_format: unknown;
    };
    expect(args).toMatchObject({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    expect(args.messages).toEqual([
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Scope: one company",
          "Recent questions (oldest first):",
          "- Tell me about another company",
          "- Who works at [C1]?",
          "- Any reviews?",
          "Question: What software does [C1] use?",
        ].join("\n"),
      },
    ]);
    const sent = JSON.stringify(args.messages);
    for (const fact of [...RESEARCH_FACTS, "eight clinics", "Opened 8th location", "Dana Reyes", "local produce", "Summit"]) {
      expect(sent, fact).not.toContain(fact);
    }
  });

  it("fails closed: a router error or an unclear label means the overview, with no answering call", async () => {
    state.classify
      .mockRejectedValueOnce(new Error("router down"))
      .mockResolvedValueOnce(modelReply({ intent: "specific_research", topic: "risks", confidence: "low" }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await POST(chatRequest({ scope: ONE }));
    const second = await ask({ scope: ONE });
    errorSpy.mockRestore();

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(second);
    expect(JSON.stringify(second)).toContain("Dental · 8 locations · Front Range, CO");
    for (const fact of RESEARCH_FACTS) {
      expect(JSON.stringify(second)).not.toContain(fact);
    }
    expect(state.create).not.toHaveBeenCalled();
  });

  it("off topic: the fixed reply, with no answering call", async () => {
    state.classify.mockResolvedValueOnce(routerReply("off_topic"));
    expect(await ask({ scope: ONE, newMessage: "Write me a poem." })).toEqual({ intro: OFF_TOPIC_REPLY, items: [] });
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("request checks", () => {
  it("rejects a bad scope or a company outside the roster without calling the model", async () => {
    const tooMany = await POST(
      chatRequest({ scope: { mode: "companies", companyIds: ["summit-dental", "falcon", "maple", "cedar"] } })
    );
    const unknown = await POST(chatRequest({ scope: { mode: "companies", companyIds: ["not-in-roster"] } }));
    const missing = await POST(chatRequest({}));

    expect(tooMany.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(state.classify).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("a question about company names", () => {
  it("All companies: names from the database, A–Z, with zero model calls", async () => {
    expect(await ask({ scope: ALL, newMessage: "tell me about companies starting with s" })).toEqual({
      intro: 'Companies whose names start with "S":',
      items: [
        {
          companyId: "summit-dental",
          companyName: "Summit Dental Group",
          text: "Dental · 8 locations · Front Range, CO",
        },
        { companyId: "summit-outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" },
      ],
    });
    expect(state.classify).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("searches only the question's scope; a single company answers with that company only", async () => {
    expect(await ask({ scope: ONE, newMessage: "which ones start with S?" })).toEqual({
      intro: 'Companies whose names start with "S":',
      items: [
        {
          companyId: "summit-dental",
          companyName: "Summit Dental Group",
          text: "Dental · 8 locations · Front Range, CO",
        },
      ],
    });
    expect(
      await ask({ scope: { mode: "companies", companyIds: ["falcon", "maple"] }, newMessage: "which start with s" })
    ).toEqual({ intro: 'No company names start with "S".', items: [] });
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("a question that mentions an unselected company", () => {
  it("returns the fixed reply (name from the database) with zero model calls", async () => {
    const res = await POST(
      chatRequest({ scope: ONE, newMessage: "How does Summit Dental Group compare to falcon market?" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      intro:
        "Your question mentions Falcon Market, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it.",
      items: [],
    });
    expect(state.classify).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.queries.some((q) => q.table === "crm_prospect_contacts")).toBe(false);
  });

  it("generic words and a first word shared with a selected company still reach the router", async () => {
    await POST(
      chatRequest({ scope: { mode: "companies", companyIds: ["falcon"] }, newMessage: "Is the family dentistry trend relevant here?" })
    );
    await POST(chatRequest({ scope: ONE, newMessage: "What does Summit do?" }));
    expect(state.classify).toHaveBeenCalledTimes(2);
  });
});
